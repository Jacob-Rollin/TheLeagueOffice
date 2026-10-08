# Native Custom Fantasy Leagues — Implementation Plan

**Decisions locked**

| Decision | Choice |
| --- | --- |
| League type (v1) | **Redraft season-long only** (Keeper / Dynasty / Best Ball / IDP deferred; document settings for later) |
| Draft modes (v1) | **Offline / commissioner-entered** + **scheduled live snake** (auction / salary-cap deferred; NFL “Auto” draft deferred) |
| Data home | **TiDB for high-churn native league ops**; **Supabase A for auth + thin membership index** |
| Mobile settings UX | **NFL Fantasy Commissioner Tools IA** (tabs + drill-down lists), styled with our existing `.mobile-theme-light` / `.mobile-theme-dark` tokens — not NFL’s black/gold chrome |

This plan is the blueprint for making “run a league natively” real. Today those tables exist on Supabase A as **schema-only** — no create/join UI, no mutation engine, incomplete settings vs host platforms. Synced Sleeper/ESPN/Yahoo Playbook remains unchanged.

**Reference:** NFL Fantasy commissioner / league settings screenshots (League Info, Scoring, Waivers/Adds/Trades, Playoffs & Ties, Divisions, Teams, Draft Settings, Keepers) inform the settings catalog and mobile IA below. Source images live in [`docs/references/nfl-fantasy-settings/`](references/nfl-fantasy-settings/). Our mobile Waivers/Trades pages ([`MobileTransactionPages.tsx`](../src/components/mobile/league/MobileTransactionPages.tsx)) already follow that list + empty-state pattern for **synced** leagues.

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

### 3.0 NFL Fantasy screenshot inventory (source of truth for IA)

Commissioner Tools root uses three tabs. Persist every field below even when v1 UI locks some to defaults.

#### Tab: League

| Screen | Fields from NFL Fantasy | Persist key(s) | v1 behavior |
| --- | --- | --- | --- |
| **League Info** | League name; league password; league start week (1–5); auto-activate next year; viewable by public; read-only league id | `name`, `join_password_hash` (optional), `season_start_week`, `auto_activate_next_year`, `is_public`, `id` | Name + invite code required; password optional; public view default off; auto-activate stored for season roll |
| **Scoring** | Tabs: Passing / Rushing / Receiving / Kicking (+ Defense/Misc). Ratio yards (“1 pt every N yds”); TDs; INTs; attempts/completions/incompletions/sacks; bonuses (300–399, 400+, 40+ TD) | `scoring_preset`, `scoring_settings` JSON (Sleeper keys) | Full editor; map yard ratios ↔ `pass_yd` etc. |
| **Waivers, Adds, Trades** | See §3.4–3.5 expanded rows | many | Full redraft set |
| **Playoffs & Ties** | Weeks per playoff matchup (1 / 2 all / 2 championship); playoff teams (none/4/6/7/8); playoff weeks (16&17 / 17&18); standings tiebreaker (PF / H2H / division); allow matchup ties; matchup tiebreaker position (Bench/QB/RB/WR/TE/K/DEF) | `playoff_*`, `standings_tiebreaker`, `allow_matchup_ties`, `matchup_tiebreaker` | Implement; division tiebreaker only if divisions on |
| **Divisions** | Toggle on/off; (when on) name divisions + assign teams | `divisions_enabled`, `divisions` JSON | **Schema + toggle in v1**; naming/assign UI ships with schedule generator when enabled |
| **Teams** | Team count chips (NFL shows 10–20); remove teams (pre-draft only) | `team_count`, `native_teams` rows | Support **4–20**; add/remove only before draft starts |
| **Managers & Co-Managers** | Invite, primary owner, co-managers | `native_teams.user_id`, roles on links | Commissioner + co-commish + member |

#### Tab: Draft

| Screen | Fields | Persist | v1 |
| --- | --- | --- | --- |
| **Draft Settings** | Draft type: Live / Auto / Offline; format: Standard / Salary Cap; order: Snake / Linear; time per pick (15/30/45/60s…) | `draft_mode`, `draft_format`, `draft_order_type`, `draft_pick_time_limit_sec`, `draft_scheduled_at` | **Live snake + Offline**; Auto + Salary Cap stored as enums but disabled in UI |

#### Tab: Rosters

| Screen | Fields | Persist | v1 |
| --- | --- | --- | --- |
| **Keeper Settings** | Keepers per team; note to managers | `keepers_per_team`, `keeper_note` | UI visible, **forced 0** / note optional; no keeper execution until Keeper phase |

#### Manager-facing (non-commish) — already partially built for synced

| Screen | Pattern | Native addition |
| --- | --- | --- |
| **Waivers** | Tabs Pending / Waiver Report; empty state; gear rows for priority, type, period | Real pending claims + report from `native_waiver_claims` |
| **Trades** | Propose CTA; empty pending; gear rows for max trades, review type, deadline, reject time | Real `native_trades` + settings from TiDB |

### 3.1 League identity & structure

| Setting | NFL | ESPN | Sleeper | v1 native |
| --- | --- | --- | --- | --- |
| League name | Yes | Yes | Yes | Yes |
| League password (join) | Yes | Optional | Invite link | Optional hash + invite code |
| League start week | Yes (1–5) | Implicit | Implicit | Yes (`season_start_week`, default 1) |
| Auto-activate next year | Yes | — | — | Persist boolean; cron uses on season roll |
| Viewable by public | Yes | Yes | Yes | Default **off**; if on, standings/matchups CDN-readable |
| Team count | 10–20 typical | Varies | Varies | **4–20** |
| Season year | Yes | Yes | Yes | Yes |
| League type Redraft / Keeper / Dynasty | Yes | Yes | Yes | **Redraft only**; store `league_type` enum for later |
| Best Ball | — | — | Yes | Deferred (`best_ball` flag reserved false) |
| Divisions | Yes | Yes | Optional | Schema + toggle; assign teams when enabled |
| Public / private | Yes | Yes | Yes | Private + invite code (password optional) |

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

Mobile editor mirrors NFL: horizontal tabs **Passing / Rushing / Receiving / Kicking / Defense / Misc**, label left / numeric field right, section **Bonuses**.

**Yard ratios:** NFL UI “1 pt every N yds” ↔ store Sleeper-style `pass_yd = 1/N` (existing `formatScoringValue` already understands this). Editor may show N and convert on save.

**Passing fields from NFL screenshot (map to keys):** yards (`pass_yd`), TDs (`pass_td`), INTs (`pass_int`), attempts (`pass_att`), completions (`pass_cmp`), incompletions (`pass_inc`), sacked (`pass_sack`), bonuses 300–399 / 400+ / 40+ TD (`bonus_pass_yd_300`, `bonus_pass_yd_400`, `pass_td_40p`). Same pattern for rush/rec/kick/def via `SCORING_GROUPS`.

**Core (all three platforms):** pass_yd/td/int/2pt, rush_yd/td/2pt, rec/rec_yd/rec_td/rec_2pt, fum_lost, K (PAT + FG buckets), DST (sack/int/fum_rec/ff/safe/blk/td + points-allowed buckets).

**Extended:** attempts, completions, first downs, 40+/50+ bonuses, yard bonuses, TE/RB/WR reception premiums, FG miss-by-distance, `fgm_50_59` / `fgm_60p`, return yards, etc.

**ESPN specifics:** map through existing `ESPN_STAT_MAP` for presets; expand K/DEF coverage in native preset templates.

**Yahoo:** not a create-path source for v1; half-PPR preset is enough if we ever import.

### 3.4 Waivers, adds & free agency (NFL-expanded)

| Setting | NFL Fantasy values | v1 |
| --- | --- | --- |
| Waiver period | No Waivers / 1–4 days | Store days (0 = none → FA only); process cron respects |
| Waiver type | Move to Last after Claim, Never Reset; Resets to Inverse Standings | Map → `rolling` / `reverse`; plus **FAAB** (ESPN/Sleeper parity) |
| Post-draft players | Free Agents / Follow Waiver Rules | `post_draft_player_status` enum |
| Lock free agents on gametime | ON/OFF | `lock_fa_on_gametime` — blocks FA add after player’s NFL kickoff |
| Max adds per week | No Maximum / N | `max_adds_per_week` NULL = unlimited |
| Max adds per season | No Maximum / N | `max_adds_per_season` NULL |
| Top players undroppable | ON/OFF | `undroppable_top_players` — when on, protect top-N by ADP/value at draft end |
| Roster lock type | Game Time / First Game | `roster_lock_type` — per-player kickoff vs week’s first kickoff |
| FAAB budget | (ESPN/Sleeper; not on this NFL screen) | Yes when `waiver_type=faab` |
| Claim priority order | Shown as “5 of 10” | Persist per team; rotate on rolling; rebuild on reverse |

### 3.5 Trades (NFL-expanded)

| Setting | NFL Fantasy values | v1 |
| --- | --- | --- |
| Max trades per season | Unlimited / N | `max_trades_per_season` NULL |
| Trade review type | Commissioner Review (+ League Vote / None on other hosts) | `trade_veto_mode`: `none` \| `commissioner` (vote deferred) |
| Trade deadline | Calendar datetime (e.g. Thu Nov 20) | `trade_deadline_at` (+ optional week mirror) |
| Trade reject / review time | Hours/days window | `trade_review_hours` |
| Trade for future picks | Dynasty | **No** in redraft v1 |

### 3.6 Schedule & playoffs (NFL-expanded)

| Setting | NFL Fantasy values | v1 |
| --- | --- | --- |
| Weeks per playoff matchup | 1 Week; 2 Weeks (All); 2 Weeks (Championship) | `playoff_matchup_length` enum |
| Playoff teams | None / 4 / 6 / 7 / 8 | `playoff_teams` (0 = disabled) |
| Playoff weeks | 16&17 / 17&18 | Derive `playoff_start_week` + length from pair |
| Standings tiebreaker | Points For / Head to Head / Division Record | `standings_tiebreaker` |
| Allow matchup ties | ON/OFF | `allow_matchup_ties` |
| Matchup tiebreaker | Bench / QB / RB / WR / TE / K / DEF | `matchup_tiebreaker_slot` — scoring engine compares that bucket |
| Regular season schedule | (generated) | Round-robin; respect divisions when enabled |
| Consolation bracket | — | Deferred |

### 3.7 Draft (NFL-expanded; v1 modes)

| Setting | NFL options | v1 |
| --- | --- | --- |
| Draft type | Live / Auto / Offline | **Live** + **Offline**; Auto deferred |
| Draft format | Standard / Salary Cap | **Standard** only; Salary Cap deferred |
| Draft order | Snake / Linear | Both |
| Time per pick | 15 / 30 / 45 / 60 (+ more as needed) | Seconds int; live only |
| Draft date/time | (schedule) | `draft_scheduled_at` |
| Commissioner assign / undo | Offline + live override | Yes |
| Autopick / queue | Live | Queue + ADP fallback on timeout |

### 3.8 Keepers (document + schema; no execution in v1)

| Setting | NFL | v1 |
| --- | --- | --- |
| Keepers per team | Stepper | Persist; UI locked at **0** |
| Note to managers | Free text | Optional string |

### 3.9 Explicitly deferred (behavior)

- Keeper execution / keeper cost / keeper rounds
- Dynasty taxi years, rookie drafts, draft capital trades
- Best Ball (no weekly lineups)
- IDP slots + IDP scoring
- Draft type Auto; draft format Salary Cap / auction
- League vote trade veto
- NFL.com guillotine / unique formats
- Full public website SEO pages (flag only)

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
  join_password_hash VARCHAR(255) NULL
  commissioner_user_id VARCHAR(36)
  status ENUM('setup','drafting','in_season','completed')
  league_type ENUM('redraft')      -- extend later: keeper, dynasty
  is_public TINYINT(1) DEFAULT 0
  auto_activate_next_year TINYINT(1) DEFAULT 1
  season_start_week TINYINT DEFAULT 1
  team_count TINYINT               -- 4–20
  current_week TINYINT
  playoff_start_week TINYINT
  playoff_teams TINYINT            -- 0 = none
  playoff_matchup_length ENUM('one','two_all','two_championship')
  playoff_week_pair VARCHAR(16)    -- e.g. '16-17' | '17-18'
  standings_tiebreaker ENUM('points_for','head_to_head','division')
  allow_matchup_ties TINYINT(1) DEFAULT 0
  matchup_tiebreaker_slot VARCHAR(8)  -- Bench|QB|RB|WR|TE|K|DEF
  divisions_enabled TINYINT(1) DEFAULT 0
  divisions JSON NULL              -- [{id,name,team_ids[]}]
  roster_slots JSON                -- RosterSlotKey → count
  scoring_preset VARCHAR(16)
  scoring_settings JSON            -- full Sleeper-keyed map
  waiver_type ENUM('rolling','reverse','faab')
  waiver_budget INT NULL
  waiver_period_days TINYINT       -- 0 = no waivers (FA only)
  waiver_clear_hours INT NULL       -- optional finer control
  waiver_process_weekday TINYINT
  waiver_process_time CHAR(5)
  post_draft_player_status ENUM('free_agents','follow_waiver_rules')
  lock_fa_on_gametime TINYINT(1) DEFAULT 1
  max_adds_per_week INT NULL
  max_adds_per_season INT NULL
  undroppable_top_players TINYINT(1) DEFAULT 0
  roster_lock_type ENUM('game_time','first_game') DEFAULT 'game_time'
  league_tz VARCHAR(64)
  trade_deadline_week TINYINT NULL
  trade_deadline_at DATETIME NULL
  trade_review_hours INT
  trade_veto_mode ENUM('none','commissioner')
  max_trades_per_season INT NULL
  draft_mode ENUM('offline','live','auto')  -- auto reserved
  draft_format ENUM('standard','salary_cap') -- salary_cap reserved
  draft_order_type ENUM('snake','linear') DEFAULT 'snake'
  draft_status ENUM('not_started','scheduled','live','paused','complete')
  draft_scheduled_at DATETIME NULL
  draft_pick_time_limit_sec INT
  draft_order JSON                 -- [team_id,…]
  current_draft_pick INT
  keepers_per_team TINYINT DEFAULT 0
  keeper_note TEXT NULL
  settings_version INT
  created_at, updated_at

native_teams
  id BIGINT PK AI
  league_id CHAR(36)
  user_id VARCHAR(36) NULL         -- null = open seat
  team_name VARCHAR(64)
  avatar_url VARCHAR(512) NULL
  division_id VARCHAR(36) NULL
  draft_slot TINYINT
  waiver_priority INT
  faab_balance INT NULL
  adds_this_week INT DEFAULT 0
  adds_this_season INT DEFAULT 0
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

1. TiDB migrate: create `native_*` tables ([`tidb-migrate.server.ts`](../src/lib/tidb-migrate.server.ts) + [`native-league-ddl.server.ts`](../src/lib/native-league-ddl.server.ts) + [`scripts/tidb/schema.sql`](../scripts/tidb/schema.sql)). **Landed** — applied on next `/api/admin/tidb-migrate` schema/migrate (CREATE IF NOT EXISTS).
2. Supabase migration: `native_league_links` + RLS (user reads own links; writes via service role / server only). **Landed** in `supabase/migrations/20261008170000_native_league_links.sql` (apply via Supabase migrate).
3. Server module [`native-league.server.ts`](../src/lib/native-league.server.ts): status + read helpers (no UI wiring yet).
4. Settings normalize helpers [`native-league-settings.ts`](../src/lib/native-league-settings.ts) (defaults, caps, v1 locks).
5. Cap: max 3 native leagues per user as commissioner in v1 (tunable) — encoded in settings helpers.

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

### Phase 5 — Mobile commissioner + polish

1. Mobile Commissioner Tools sheet (§8) — League / Draft / Rosters drill-downs with SAVE, light+dark.
2. Wire native claims/trades into existing Waivers/Trades mobile pages.
3. Co-commissioner role, email/link invites, push-less in-app toasts.
4. Commissioner tools: force drop, reverse transaction, edit scores (audit log).
5. Export season JSON / CSV.
6. Document deferred Keeper execution / Dynasty / Best Ball / IDP / Auto draft / Salary Cap → Phase N.

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

**Hard product caps (v1):** ≤20 teams/league, ≤3 commissioner leagues/user, claim queue length cap, transaction log pagination (no unbounded dumps).

**Monitoring:** log TiDB RU-ish proxies (query count / latency) on native cron and mutation routes; alert if native traffic dominates Fluid Active CPU (reuse lean cron style from `league-delta-sync.yml`).

---

## 8. Mobile Commissioner Tools UX (NFL IA × our themes)

Mobile settings menus follow the **information architecture** of NFL Fantasy Commissioner Tools, but use **our** `/m` theme system — never copy NFL black/gold as a new palette.

### 8.1 Theme mapping

Wrap all commissioner screens in existing [`MobileShell`](../src/components/mobile/MobileShell.tsx) / `mobile-theme-light|dark` ([`styles.css`](../src/styles.css)):

| NFL screenshot cue | Our token / pattern |
| --- | --- |
| Near-black page bg | `--m-bg` (light `#e4e1da`, dark `#121212`) |
| Header bar | `--m-header` / `--m-header-fg` (light cyan header, dark `#121212`) |
| Close / back icon button | `--m-icon-bg` / `--m-icon-fg` (same pattern as [`MobileSettingsOverlay`](../src/components/mobile/MobileSettings.tsx)) |
| Active tab underline / selected chip | `--m-accent` / `--m-tab-active` (teal/cyan — already matches NFL accent role) |
| List row text | `--m-card-fg`; secondary subtext `--m-muted` |
| Dividers | `--m-border` |
| Primary CTA (Propose Trade) | `--m-cta` / `--m-cta-fg` (our yellow CTA — do **not** switch to NFL gold nav) |
| Bottom nav active | `--m-nav-active` (blue, already intentionally not yellow) |
| Form inputs / chips | `--m-select-bg` / `--m-chip`; selected segment `--m-tab-active` |
| Sheet / nested card | `--m-sheet` / `--m-card` |

**Rule:** Structure and control types match NFL; colors and fonts stay League Office mobile (Archivo / display utilities already used under `/m`).

### 8.2 Information architecture (routes)

```
/m/league/$leagueId/commissioner          → root sheet: tabs League | Draft | Rosters
  League/
    league-info                           → name, password, start week, toggles, id
    scoring                               → Passing|Rushing|Receiving|Kicking|Defense|Misc + SAVE
    waivers-adds-trades                   → waiver/add/trade settings + SAVE
    playoffs-ties                         → playoff + tiebreaker settings + SAVE
    divisions                             → toggle (+ assign when on)
    teams                                 → team count chips + Remove Teams
    managers                              → invites, co-managers
  Draft/
    draft-settings                        → type/format/order/timer + SAVE
  Rosters/
    keeper-settings                       → keepers stepper (locked 0) + note
```

Manager-facing (already stubbed for synced; wire native writes):

- `/m/league/$leagueId/waivers` — Pending | Waiver Report + settings rows  
- `/m/league/$leagueId/trades` — Propose Trade + settings rows  

Entry: League tab overflow / gear → “Commissioner Tools” (commissioner & co-commish only).

### 8.3 Reusable mobile components to add

Extend patterns already in [`MobileTransactionPages.tsx`](../src/components/mobile/league/MobileTransactionPages.tsx) and [`MobileSettings.tsx`](../src/components/mobile/MobileSettings.tsx):

| Component | Role |
| --- | --- |
| `MobileCommishSheet` | Full-screen overlay; title; X close; sticky header |
| `MobileCommishTabs` | League / Draft / Rosters; `border-m-accent` underline |
| `MobileSettingsNavRow` | Label + chevron `>` drill-down |
| `MobileSettingRow` | Gear + title + muted value (reuse existing `SettingRow`) |
| `MobileSegmentedChoice` | Horizontal chip group (waiver period, team count, draft type…) |
| `MobileToggleRow` | Label + description + switch |
| `MobileStepperRow` | − / value / + (keepers) |
| `MobileFormField` | Label above rounded input; optional trailing eye icon |
| `MobileSaveHeader` | Back + title + SAVE |
| `MobileEmptyState` | Icon + headline + helper + outline button |

All controls must be theme-token driven (`bg-m-*`, `text-m-*`, `border-m-*`) so light/dark flip with [`MobileThemeContext`](../src/components/mobile/MobileThemeContext.tsx).

### 8.4 Desktop commissioner

Desktop Playbook keeps Broadcast chrome (`SiteNav` + `PlaybookShell`). Settings can be a denser form of the same field groups — do **not** port mobile dark-sheet look to desktop research/playbook pages.

---

## 9. Product surfaces to build

| Surface | Notes |
| --- | --- |
| Create League wizard | Presets mirroring NFL/ESPN/Sleeper redraft defaults |
| Invite / join | Code + link (+ optional password); open seats |
| Mobile Commissioner Tools | §8 — NFL IA, our light/dark tokens |
| League settings | Read-only mid-season for structural fields |
| Draft room | Offline assign + live snake |
| Playbook native | Dashboard, My Team, Matchup, Standings, Rosters, Transactions — same chrome as synced |
| Waivers | Claim UI distinct from The Wire **suggestions** (keep suggestions for synced; native uses real claims) |
| Trade | Real propose/accept (Trade Desk analyzer can score packages against native rosters later) |
| Commissioner console | Scores, force txns, schedule, draft controls |
| Active league switcher | Native + synced + sandbox coexist |

Reuse: `PlaybookShell`, `PlayerModalHost`, `ActiveLeagueLabel`, research boards (scoring format from native `scoring_settings`). Desktop = Broadcast; mobile `/m` = existing mobile themes.

---

## 10. Scoring engine notes

1. Normalize all presets to Sleeper keys (existing philosophy in `scoring-map.ts`).
2. Week stats source: prefer already-budgeted public/snap paths; one bundle per week, apply to all native leagues in cron (amortize RU + Sleeper budget).
3. Store per-player fantasy points on lineup + matchup snapshot (hosts do this — needed for history and disputes).
4. Commissioner score override writes audit row in `native_transactions` (`type=commish_score`).

---

## 11. Invites (league vs site)

| Mechanism | Purpose | Store |
| --- | --- | --- |
| Site `invite_codes` | Signup gate | Supabase (unchanged) |
| League `invite_code` | Join native league | TiDB `native_leagues.invite_code` |
| Optional league password | Extra gate (NFL Fantasy parity) | `join_password_hash` (never store plaintext) |
| Optional email deep link | `/join/:code` | Same code |

Regenerate code = commissioner action; rate-limit join attempts server-side.

---

## 12. Testing plan

1. **Unit:** claim sort (FAAB ties, rolling rotation), roster legality, schedule generator, scoring apply on fixture stats.
2. **Concurrency:** parallel add same player (one 200, one 409); parallel draft picks; trade vs FA race.
3. **Cron:** waiver batch idempotency (re-run same `process_batch_id` no double award).
4. **Load smoke:** N leagues × M managers lineup save — watch TiDB + Fluid.
5. **UI:** create → invite → offline draft → week lineup → FA race → waiver clear → trade → finalize week.

---

## 13. Risks & open engineering follow-ups (non-blocking)

- **Realtime:** v1 = polling with `page-visibility`; Supabase Realtime not used for TiDB state.
- **Legal/ToS:** native hosting increases responsibility for fair commissioner tools and dispute audit logs.
- **Supabase orphan tables:** leave until native TiDB path is proven; then drop in a cleanup migration.
- **Yahoo/NFL import into native:** out of scope; presets only.
- **Sandbox mode:** keep for Trade Desk without league; native leagues are real persistence.

---

## 14. Suggested implementation order (engineering tickets)

1. TiDB `native_*` DDL (NFL-expanded columns) + migrate action  
2. Supabase `native_league_links`  
3. Auth-gated TiDB client helper + membership checks  
4. Create/join/settings APIs + shared Zod settings schema  
5. Mobile Commissioner Tools shell (tabs + nav rows + theme tokens) + desktop wizard  
6. Offline draft + roster commit  
7. Schedule generator + Playbook/mobile read surfaces (CDN history stubs)  
8. Lineup save + lock (`game_time` / `first_game`)  
9. FA add/drop with league lock + add caps / undroppable / FA gametime lock  
10. Waiver claims + cron (rolling / reverse / FAAB)  
11. Trades + veto cron  
12. Live snake draft  
13. Weekly scoring cron + standings + playoff/tiebreakers + archive  
14. Commissioner audit tools + caps/monitoring  
15. Keeper/Auto/Salary Cap unlock later  

---

## 15. Success criteria (v1)

- Commissioner creates a redraft league, invites managers, completes offline or live snake draft.
- Mobile Commissioner Tools mirrors NFL IA (League / Draft / Rosters) and works in both light and dark mobile themes.
- Managers set lineups; two managers cannot own the same player; waiver/FAAB/trade paths are race-safe.
- Week scores and matchups persist; prior weeks remain readable without burning Fluid/TiDB on every view.
- Synced Sleeper/ESPN/Yahoo flows and free-tier guardrails in `.cursorrules` remain intact.
- Keeper/Dynasty/Best Ball/IDP/auction explicitly not required for v1 launch.
