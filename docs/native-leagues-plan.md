# Native Custom Fantasy Leagues — Implementation Plan

**Decisions locked**

| Decision | Choice |
| --- | --- |
| League type (v1) | **Redraft season-long only** (Keeper / Dynasty / Best Ball / IDP deferred; document settings for later) |
| Draft modes (v1) | **Offline / commissioner-entered** + **scheduled live snake** (auction deferred) |
| Data home | **TiDB for high-churn native league ops**; **Supabase A for auth + thin membership index** |

This plan is the blueprint for making “run a league natively” real. Today those tables exist on Supabase A as **schema-only** — no create/join UI, no mutation engine, incomplete settings vs host platforms. Synced Sleeper/ESPN/Yahoo Playbook remains unchanged.

---

## 1. Current state

### What already exists

- **Supabase A (unused for ops):** `leagues`, `league_members`, `league_schedules`, `league_scoring_settings`, `lineups`, `rosters`, `transactions`, `waiver_claims`, `league_historical_archive`
- **Runtime settings model (synced hosts):** [`LeagueSettingsDetail`](../src/lib/league-settings.ts), [`SCORING_GROUPS`](../src/lib/league-settings.ts), [`ScoringMap`](../src/lib/scoring-map.ts)
- **TiDB (synced + research):** `player_warehouse`, `synced_*`, `agg_*` — browse via CDN `/api/data/*` + `processMemo` ([`scripts/tidb/schema.sql`](../scripts/tidb/schema.sql))
- **Draft UI (local only):** War Room / Mock Draft — `localStorage`, not server-authoritative
- **Invite codes:** site signup gate only (`invite_codes`), not league join

### Gaps

- No app CRUD against native league tables
- RLS allows member SELECT / own roster-lineup-waiver writes, but **no create/join policies** on `leagues` / `league_members`
- `league_scoring_settings` is a **fixed column subset** — missing most of `SCORING_GROUPS` (bonuses, FG miss splits, yards-allowed, etc.)
- Native `leagues` missing K/DST/SFLEX/WRRB/WRTE, waiver type/FAAB, trade deadline, draft schedule, season year
- **Zero concurrency model** for competing adds/claims/trades
- README claims native leagues; product path is synced-only (`PlaybookShell` → `/leaguesync`)

---

## 2. Database architecture (why hybrid TiDB)

### Recommendation: Supabase auth + TiDB ops

| Store | Owns | Why |
| --- | --- | --- |
| **Supabase A** | Auth sessions, `profiles`, thin `native_league_links` (user ↔ league membership for account UI), site `invite_codes` | Auth cannot move; membership index is low-churn and keeps “my leagues” cheap without TiDB on every nav |
| **TiDB** | League config, rosters, lineups, claims, trades, draft picks, schedules, week scores, season archives, transaction log | Active seasons are write-heavy (lineups, waivers, trades, live scoring). TiDB Serverless is already our warehouse path; keep ops off Supabase free Postgres size/egress/connection pressure |
| **Vercel Fluid** | Authenticated mutation RPCs + cron processors only | Never browse-path compute; never N Fluid calls per row |
| **Edge / CDN** | Past-week matchups, standings snapshots, season archives | Same RU shield as synced history (`leagueHistoryCacheControl`) |

### Why not “all Supabase”

- Free-tier Postgres + egress struggle under concurrent waiver nights across many leagues.
- We already dual-write high-volume synced matchups to TiDB for this reason.
- Client RLS writes for contested free agents are hard to make race-safe without RPC/locks anyway — so browser→Supabase direct writes are not a win.

### Why not “all TiDB” (no Supabase)

- Auth/identity stays on Supabase.
- Anonymous TiDB from the browser is unsafe; every mutation must be server-gated with a JWT check.

### TiDB free-tier RU discipline (non-negotiable)

Native leagues **will** burn RUs if every manager polls TiDB every few seconds. Apply the same patterns as synced leagues:

1. **Mutations only on user action** (or cron) — no hidden write storms.
2. **Live league state** (current week roster/lineup/claims): private authenticated API with `processMemo` coalesce + short `Cache-Control: private, max-age=5–15` (or ETag). Not public CDN (leaks other teams’ claim queues).
3. **History** (finalized weeks, past seasons): public-or-member CDN with long TTL like [`leagueHistoryCacheControl`](../src/lib/api-cache.ts); cron materializes snapshots.
4. **Scoring apply / waiver clear / draft clock**: GitHub Actions cron → `/api/cron/native-*` with `CRON_SECRET` — not per-visitor Fluid.
5. **Chunked upserts** (existing `chunkRows` pattern in `tidb-sync.server.ts`).
6. **Soft-empty** on cold miss for browse; never fall through to expensive recompute on anonymous traffic.
7. **Cap league size** in v1 (e.g. 4–14 teams) and **cap concurrent native leagues per user** to bound worst-case RUs.
8. **Do not** mirror every transaction into Supabase “just in case.”

Supabase free tier stays healthy because it only sees auth + occasional membership row inserts.

---

## 3. Platform settings catalog (document & preserve)

Canonical runtime shape for native leagues should extend [`LeagueSettingsDetail`](../src/lib/league-settings.ts) into a persisted `settings_json` (Sleeper-keyed scoring map + structured knobs). Below is the **redraft v1** catalog — store everything we need for parity with NFL.com / ESPN / Sleeper redraft; defer dynasty/IDP/best-ball **behavior**, but keep schema extensible via JSON so we do not paint ourselves into fixed columns again.

### 3.1 League identity & structure

| Setting | NFL | ESPN | Sleeper | v1 native |
| --- | --- | --- | --- | --- |
| League name | Yes | Yes | Yes | Yes |
| Team count (typically 4–14 / 8–12) | Yes | Yes | Yes | Yes (4–14) |
| Season year | Yes | Yes | Yes | Yes |
| League type Redraft / Keeper / Dynasty | Yes | Yes | Yes | **Redraft only**; store `league_type` enum for later |
| Best Ball | — | — | Yes | Deferred (`best_ball` flag reserved false) |
| Divisions | Yes | Yes | Optional | Deferred (flat schedule) |
| Public / private | Yes | Yes | Yes | Private + invite code |

### 3.2 Roster slots

Reuse `ROSTER_SLOT_KEYS`: QB, RB, WR, TE, FLEX, WRRB, WRTE, SFLEX, K, DEF (UI **DST**), BN, IR, TAXI.

| Slot | v1 | Notes |
| --- | --- | --- |
| Core offense + FLEX + K + DST + BN + IR | Yes | Missing from current Supabase `leagues` columns — store as JSON map |
| SFLEX / WRRB / WRTE | Yes | Common on Sleeper/ESPN; needed for parity |
| TAXI | Schema reserved | Dynasty-oriented; allow 0 only in v1 UI |
| IDP (DL/LB/DB) | Deferred | Explicitly dropped today in settings loaders |

Also persist: `max_roster_spots`, IR eligibility rules (must be designated OUT/IR/PUP — match host norms), bench size.

### 3.3 Scoring (store as Sleeper-keyed `Record<string, number>`)

**Do not** expand `league_scoring_settings` fixed columns. Persist full map + `scoring_preset` (`std` \| `half` \| `ppr` \| `custom`).

**Core (all three platforms):** pass_yd/td/int/2pt, rush_yd/td/2pt, rec/rec_yd/rec_td/rec_2pt, fum_lost, K (PAT + FG buckets), DST (sack/int/fum_rec/ff/safe/blk/td + points-allowed buckets).

**Extended (Sleeper-complete; ESPN/NFL custom leagues use subsets):** from `SCORING_GROUPS` — attempts, first downs, 40+/50+ bonuses, 100/200/300/400 yard bonuses, TE/RB/WR reception premiums, FG miss-by-distance, `fgm_50_59` / `fgm_60p`, return yards, etc.

**NFL.com specifics to support via same map:** standard / PPR / half; custom point values; fractional points; defense PA brackets (align keys to Sleeper `pts_allow_*`).

**ESPN specifics:** map through existing `ESPN_STAT_MAP` concepts when importing presets; expand map coverage for K distance + DEF when building native preset templates (native leagues are not ESPN sync — presets are UX copy).

**Yahoo:** not a create-path source for v1; half-PPR preset is enough if we ever import.

### 3.4 Waivers & free agency

| Setting | NFL | ESPN | Sleeper | v1 |
| --- | --- | --- | --- | --- |
| Waiver type: Rolling / Reverse standings / FAAB | Yes | Yes | Yes | All three |
| FAAB budget | Yes | Yes | Yes | Yes when type=FAAB |
| Waiver clear / period (hours or days) | Yes | Yes | Yes | Store hours; UI can show days |
| Daily waivers vs weekly | Partial | Partial | `daily_waivers` | Weekly process cron + optional daily clear time |
| Waiver process time (e.g. Wed AM) | Yes | Yes | Yes | Cron schedule + league timezone |
| Free agent after clear (first come) | Yes | Yes | Yes | Yes — **requires locking** (see §6) |
| Claim priority order | Yes | Yes | Yes | Persist per team; rotate on Rolling |

### 3.5 Trades

| Setting | NFL | ESPN | Sleeper | v1 |
| --- | --- | --- | --- | --- |
| Trades enabled | Yes | Yes | Yes | Yes |
| Trade deadline (week or datetime) | Yes | Date | Week | Store both week + optional timestamp |
| Review / veto window (hours/days) | Yes | Yes | Review days | Yes |
| Veto: commissioner / league vote / none | Yes | Yes | Yes | Commish + none in v1; vote deferred |
| Max trades / season | — | Yes | — | Optional |
| Trade for future picks | Dynasty | Dynasty | Dynasty | **No** in redraft v1 |

### 3.6 Schedule & playoffs

| Setting | v1 |
| --- | --- |
| Regular season weeks | Generate 1…`playoff_start_week - 1` |
| Playoff teams / start week / rounds | Yes |
| Consolation bracket | Deferred |
| Medial / third-place game | Optional flag deferred |
| Matchup pairing algorithm | Snake-friendly round-robin generator (deterministic seed) |
| Lineup lock | Per player NFL game start (preferred) or week kickoff |

### 3.7 Draft (v1 modes)

| Setting | Offline | Live snake |
| --- | --- | --- |
| Draft date/time (UTC + league tz display) | Optional scheduled “draft night” marker | Required for clock |
| Rounds | Yes | Yes |
| Snake vs linear | Commissioner order | Snake default |
| Pick timer seconds | N/A | Yes (`draft_pick_time_limit`) |
| Draft order | Manual / random | Random + commissioner reorder before start |
| Autopick / queue | N/A | Simple queue + autopick on timeout |
| Commissioner assign pick | **Primary path** | Override stuck picks |
| Auction | — | Deferred |

### 3.8 Explicitly deferred (document only)

- Keeper count / keeper cost / keeper rounds
- Dynasty taxi years, rookie drafts, draft capital trades
- Best Ball (no weekly lineups)
- IDP slots + IDP scoring
- Divisions + strength-of-schedule custom schedules
- League vote veto
- DFS-style salary caps
- NFL.com “guillotine” / unique formats

---

## 4. Target TiDB schema (native ops)

New tables in `league-office-native` (prefix `native_` to avoid colliding with `synced_*`). Auth user ids are UUID strings from Supabase.

### 4.1 Core

```
native_leagues
  id CHAR(36) PK
  season_year SMALLINT
  name VARCHAR(128)
  invite_code VARCHAR(16) UNIQUE   -- league join, not site signup
  commissioner_user_id VARCHAR(36)
  status ENUM('setup','drafting','in_season','completed')
  league_type ENUM('redraft')      -- extend later
  team_count TINYINT
  current_week TINYINT
  playoff_start_week TINYINT
  playoff_teams TINYINT
  roster_slots JSON                -- RosterSlotKey → count
  scoring_preset VARCHAR(16)
  scoring_settings JSON            -- full Sleeper-keyed map
  waiver_type ENUM('rolling','reverse','faab')
  waiver_budget INT NULL
  waiver_clear_hours INT
  waiver_process_weekday TINYINT   -- 0=Sun … UTC/league tz
  waiver_process_time CHAR(5)      -- HH:MM in league_tz
  league_tz VARCHAR(64)
  trade_deadline_week TINYINT NULL
  trade_deadline_at DATETIME NULL
  trade_review_hours INT
  trade_veto_mode ENUM('none','commissioner')
  draft_mode ENUM('offline','live_snake')
  draft_status ENUM('not_started','scheduled','live','paused','complete')
  draft_scheduled_at DATETIME NULL
  draft_pick_time_limit_sec INT
  draft_order JSON                 -- [team_id,…]
  current_draft_pick INT
  settings_version INT             -- bump on settings change
  created_at, updated_at

native_teams
  id BIGINT PK AI
  league_id CHAR(36)
  user_id VARCHAR(36) NULL         -- null = open seat / AI placeholder later
  team_name VARCHAR(64)
  avatar_url VARCHAR(512) NULL
  draft_slot TINYINT
  waiver_priority INT
  faab_balance INT NULL
  UNIQUE(league_id, user_id)
  UNIQUE(league_id, draft_slot)

native_rosters
  league_id + team_id PK
  player_ids JSON                  -- sleeper ids[]
  reserve_ir JSON
  updated_at
  version INT                      -- optimistic concurrency

native_lineups
  league_id, team_id, season_year, week  UNIQUE
  slots JSON                       -- { QB: [id], RB: [...], … }
  locked_at DATETIME NULL
  team_total_points DECIMAL(8,2)
  player_points JSON
  updated_at, version

native_schedules
  league_id, season_year, week, matchup_id
  home_team_id, away_team_id
  UNIQUE(league_id, season_year, week, team_id) via two rows or JSON pair table
```

### 4.2 Transactions & contention

```
native_transactions
  id BIGINT PK
  league_id, team_id NULL, type, status
  payload JSON                     -- adds/drops/trade legs
  created_by, created_at, processed_at
  INDEX(league_id, created_at)

native_waiver_claims
  id BIGINT PK
  league_id, team_id
  player_to_add VARCHAR(32)
  player_to_drop VARCHAR(32) NULL
  bid_amount INT NULL              -- FAAB
  priority_at_submit INT           -- snapshot
  status ENUM('pending','won','lost','cancelled')
  process_batch_id BIGINT NULL
  created_at
  UNIQUE open claim per (league_id, team_id, player_to_add) WHERE pending

native_player_locks
  league_id, player_id  PK         -- who currently owns free-agent contention row
  held_by_team_id NULL
  lock_reason ENUM('roster','pending_fa','trade_hold')
  updated_at

native_trades
  id, league_id, proposer_team_id, acceptor_team_id
  status ENUM('proposed','accepted','veto_window','completed','rejected','cancelled','vetoed')
  legs JSON                        -- players each way
  proposed_at, respond_by, veto_until, completed_at
```

### 4.3 Draft

```
native_draft_picks
  league_id, pick_number PK
  round, team_id
  player_id NULL
  picked_at NULL
  source ENUM('manager','autopick','commissioner')

native_draft_queues
  league_id, team_id, player_id, rank
```

### 4.4 History (everything hosts store)

```
native_matchup_results     -- finalized week boards (CDN-friendly)
  league_id, season_year, week, team_id UNIQUE
  matchup_id, points, opponent_team_id
  starters JSON, player_points JSON, projected_points
  finalized_at

native_season_standings_snap
  league_id, season_year, as_of_week
  standings JSON                   -- W/L/PF/PA/rank
  updated_at

native_season_archive
  league_id, season_year PK
  champion_team_id
  final_standings JSON
  awards JSON                      -- highest week player/team, etc.
  created_at
```

### 4.5 Supabase thin index

```
native_league_links  (Supabase A)
  id uuid PK
  user_id uuid → profiles
  native_league_id text            -- TiDB id
  team_id bigint
  role text                        -- commissioner | co_commish | member
  season_year int
  label text
  created_at
  UNIQUE(user_id, native_league_id)
```

Deprecate unused Supabase `leagues` / `lineups` / … for new work (leave tables; do not write). Optional later migration script to drop after cutover.

---

## 5. Phased rollout

### Phase 0 — Foundations (schema + auth glue)

1. TiDB migrate: create `native_*` tables ([`tidb-migrate.server.ts`](../src/lib/tidb-migrate.server.ts) + [`scripts/tidb/schema.sql`](../scripts/tidb/schema.sql)).
2. Supabase migration: `native_league_links` + RLS (user reads own links; writes via service role / server only).
3. Server module `native-league.server.ts`: JWT verify → membership check → TiDB pool.
4. Settings Zod schema shared with UI (extend `LeagueSettingsDetail`).
5. Cap: max 3 native leagues per user as commissioner in v1 (tunable).

### Phase 1 — Create / invite / join / setup

1. UI: Create League wizard (name, teams, roster, scoring preset → custom editor using `SCORING_GROUPS`, waivers, trades, playoffs, draft mode).
2. Generate league `invite_code`; share link `/join/:code`.
3. Join flow: auth required → claim open seat → write TiDB team + Supabase link.
4. Commissioner: rename teams, kick/open seat, edit settings until `draft_status` leaves `not_started` (then lock scoring/roster structure for the season; allow cosmetic edits).
5. Wire Active League / PlaybookShell to accept `platform: 'native'` tokens alongside synced connections.

### Phase 2 — Draft

1. **Offline:** commissioner draft board — search players, assign to team, undo last pick; marks players owned; completes → season start.
2. **Live snake:** schedule `draft_scheduled_at`; lobby; server-authoritative pick endpoint with row lock on `native_leagues` draft cursor; timer via cron tick or pick-time check on read; autopick from queue / ADP fallback; commissioner pause/force-pick.
3. Reuse War Room UI patterns where possible; **persist to TiDB**, not `localStorage`.
4. On complete: populate `native_rosters`, set `status=in_season`, generate `native_schedules`.

### Phase 3 — In-season ops (lineups, FA, waivers, trades)

1. Lineup editor → `native_lineups` with version column; lock at player game start (NFL schedule from existing public/snap sources — **no Fluid fan-out**).
2. Free agent add/drop — transactional lock (§6).
3. Waiver claims queue + weekly/daily process cron.
4. Trade propose/accept + commissioner veto window.
5. Transaction log UI (reuse Playbook Transactions layout).

### Phase 4 — Scoring, matchups, standings, history

1. Cron: pull week stats (prefer snap-cdn / public Sleeper stats already budgeted) → apply `scoring_settings` → write `native_lineups.player_points` + `native_matchup_results`.
2. Standings materialization → `native_season_standings_snap`.
3. Playoff bracket seeding from standings.
4. Season roll → `native_season_archive`; reset or new `season_year` row for following year (redraft redrafts).
5. CDN route `/api/data/native-league/$id` for history views (member auth or league-private token — prefer auth).

### Phase 5 — Polish & parity

1. Co-commissioner role, email/link invites, push-less in-app toasts.
2. Commissioner tools: force drop, reverse transaction, edit scores (audit log).
3. Export season JSON / CSV.
4. Mobile `/m` native league paths.
5. Document deferred Keeper/Dynasty/Best Ball/IDP → Phase N.

---

## 6. Concurrency & correctness (add / drop / trade / waivers)

Hosts solve “two managers add the same player” with **server-side serialization**. We must too — browser checks are UX only.

### 6.1 Free agent add/drop (immediate)

Single TiDB transaction per league:

1. `SELECT … FROM native_leagues WHERE id=? FOR UPDATE` (league row = mutex), **or** advisory lock table keyed by `league_id`.
2. Verify actor membership, roster version, player is unowned (`native_player_locks` / not in any roster).
3. Verify drop player owned by actor; post-drop roster still fills required starter slots when in season (existing product rule: never leave essential vacancy / solo DST).
4. Apply roster JSON update; bump `native_rosters.version`.
5. Insert `native_transactions`; update `native_player_locks`.
6. Commit. Loser gets `409 PLAYER_TAKEN` with refreshed FA list.

**Optimistic concurrency:** client sends `roster_version`; mismatch → reload.

### 6.2 Waiver claims

- Submitting a claim **does not** move the player; only inserts `native_waiver_claims` (unique pending add per team).
- Process cron (Actions → `/api/cron/native-waivers`):
  1. Lock league.
  2. Load pending claims; sort by FAAB bid (desc, tie → waiver_priority) or waiver_priority for rolling/reverse.
  3. For each claim in order: if player free and drop legal → award; else mark lost.
  4. Rolling: awarded team moves to end of priority; Reverse: rebuild from standings weekly.
  5. FAAB: decrement budget; never award over budget.
  6. Batch id for audit; write transactions.

### 6.3 Trades

1. Propose → validate both rosters would be legal.
2. Accept → `status=veto_window` until `veto_until`, holding players via `trade_hold` locks (cannot be dropped/FA).
3. On window end cron: commit swap or commissioner veto.
4. Concurrent accept of two trades involving same player: league lock + lock rows; second fails cleanly.

### 6.4 Draft picks

- `FOR UPDATE` on league draft cursor; only current `team_id` (or commissioner) may pick; player must be undrafted (`native_draft_picks.player_id` unique per league).
- Idempotent pick requests (client `intent_id`) to avoid double-spend on retry.

### 6.5 Lineup saves

- Version check; reject stale writes.
- After lock time, ignore non-commissioner edits for that slot/player.

### 6.6 Multiplayer UX

- Short polling or visibility-aware refresh (`page-visibility.ts`) for FA list / draft room — **not** tight loops; backoff when hidden.
- Toast + list refresh on `409`.
- Never rely on client-only “is available” flags.

---

## 7. Free-tier budget map

| Surface | Path | Budget rule |
| --- | --- | --- |
| Create/join/settings | Fluid `createServerFn` / API + TiDB write | Rare; OK |
| Lineup / FA / claim / trade | Authenticated mutation API + TiDB tx | Per user action only |
| Live board (matchup, FA) | Private API + processMemo + short private cache | Coalesce; no public leak |
| Past weeks / archives | `/api/data/native-league/*` + history Cache-Control | Cron warm; SELECT only |
| Scoring apply | Actions cron | Shared across leagues; batch by week |
| Waiver process | Actions cron | Nightly / configured slot |
| Draft clock | Pick-on-read timeout + light cron tick (≤1/min globally or per live draft) | Avoid 1s Fluid polls |
| Player catalog / stats | Existing snap-cdn + Sleeper budget (`sleeper-rate-budget`) | No new Fluid public reads |
| Supabase | Auth + `native_league_links` | Low churn |
| Synced Playbook | Unchanged | Keep Fluid bans in `.cursorrules` |

**Hard product caps (v1):** ≤14 teams/league, ≤3 commissioner leagues/user, claim queue length cap, transaction log pagination (no unbounded dumps).

**Monitoring:** log TiDB RU-ish proxies (query count / latency) on native cron and mutation routes; alert if native traffic dominates Fluid Active CPU (reuse lean cron style from `league-delta-sync.yml`).

---

## 8. Product surfaces to build

| Surface | Notes |
| --- | --- |
| Create League wizard | Presets mirroring NFL/ESPN/Sleeper redraft defaults |
| Invite / join | Code + link; open seats; commissioner approve optional (default open with code) |
| League settings | Read-only mid-season for structural fields |
| Draft room | Offline assign + live snake |
| Playbook native | Dashboard, My Team, Matchup, Standings, Rosters, Transactions — same chrome as synced |
| Waivers | Claim UI distinct from The Wire **suggestions** (keep suggestions for synced; native uses real claims) |
| Trade | Real propose/accept (Trade Desk analyzer can score packages against native rosters later) |
| Commissioner console | Scores, force txns, schedule, draft controls |
| Active league switcher | Native + synced + sandbox coexist |

Reuse: `PlaybookShell`, `PlayerModalHost`, `ActiveLeagueLabel`, research boards (scoring format from native `scoring_settings`). Do **not** invent a new visual theme — Broadcast tokens.

---

## 9. Scoring engine notes

1. Normalize all presets to Sleeper keys (existing philosophy in `scoring-map.ts`).
2. Week stats source: prefer already-budgeted public/snap paths; one bundle per week, apply to all native leagues in cron (amortize RU + Sleeper budget).
3. Store per-player fantasy points on lineup + matchup snapshot (hosts do this — needed for history and disputes).
4. Commissioner score override writes audit row in `native_transactions` (`type=commish_score`).

---

## 10. Invites (league vs site)

| Mechanism | Purpose | Store |
| --- | --- | --- |
| Site `invite_codes` | Signup gate | Supabase (unchanged) |
| League `invite_code` | Join native league | TiDB `native_leagues.invite_code` |
| Optional email deep link | `/join/:code` | Same code |

Regenerate code = commissioner action; rate-limit join attempts server-side.

---

## 11. Testing plan

1. **Unit:** claim sort (FAAB ties, rolling rotation), roster legality, schedule generator, scoring apply on fixture stats.
2. **Concurrency:** parallel add same player (one 200, one 409); parallel draft picks; trade vs FA race.
3. **Cron:** waiver batch idempotency (re-run same `process_batch_id` no double award).
4. **Load smoke:** N leagues × M managers lineup save — watch TiDB + Fluid.
5. **UI:** create → invite → offline draft → week lineup → FA race → waiver clear → trade → finalize week.

---

## 12. Risks & open engineering follow-ups (non-blocking)

- **Realtime:** v1 = polling with `page-visibility`; Supabase Realtime not used for TiDB state.
- **Legal/ToS:** native hosting increases responsibility for fair commissioner tools and dispute audit logs.
- **Supabase orphan tables:** leave until native TiDB path is proven; then drop in a cleanup migration.
- **Yahoo/NFL import into native:** out of scope; presets only.
- **Sandbox mode:** keep for Trade Desk without league; native leagues are real persistence.

---

## 13. Suggested implementation order (engineering tickets)

1. TiDB `native_*` DDL + migrate action  
2. Supabase `native_league_links`  
3. Auth-gated TiDB client helper + membership checks  
4. Create/join/settings APIs + wizard UI  
5. Offline draft + roster commit  
6. Schedule generator + Playbook read surfaces (CDN history stubs)  
7. Lineup save + lock  
8. FA add/drop with league lock  
9. Waiver claims + cron  
10. Trades + veto cron  
11. Live snake draft  
12. Weekly scoring cron + standings + archive  
13. Commissioner console + audit  
14. Mobile paths + caps/monitoring  

---

## 14. Success criteria (v1)

- Commissioner creates a redraft league, invites managers, completes offline or live snake draft.
- Managers set lineups; two managers cannot own the same player; waiver/FAAB/trade paths are race-safe.
- Week scores and matchups persist; prior weeks remain readable without burning Fluid/TiDB on every view.
- Synced Sleeper/ESPN/Yahoo flows and free-tier guardrails in `.cursorrules` remain intact.
- Keeper/Dynasty/Best Ball/IDP/auction explicitly not required for v1 launch.
