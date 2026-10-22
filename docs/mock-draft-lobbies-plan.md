# Multiplayer Mock Draft Lobbies — Implementation Plan

**Decisions locked**

| Decision | Choice |
| --- | --- |
| Product | **Standalone practice rooms** — friends draft together; AI fills empty seats. Not native-league season drafts. |
| Create | **Logged-in host only** (Supabase auth) |
| Join | **Anyone with the room code** — signed-in users claim a seat with `user_id`; guests get a signed `guest_token` bound to that seat |
| Solo simulator | Keep `/mock-draft/setup` → `/mock-draft` as-is (client-only AI). Multiplayer is a parallel path. |
| Native live snake | **Out of scope.** Remains deferred in [`native-leagues-plan.md`](native-leagues-plan.md) Phase 2. Do not hitch mock rooms to `native_*` tables or `/league/$linkId/draft`. |
| Realtime | **Visibility-aware short polling** (same posture as native §6.6). No websockets / Supabase Realtime for TiDB state. |
| Data home | **Dedicated TiDB Starter D** for `mock_draft_*`; **Supabase** for auth only (optional thin “my past mocks” index later). |
| Completed boards | Freeze a compact JSON snapshot on complete; retain **7–14 days**; share via opaque token; CSV/JSON export client-side from that snapshot. |
| Vercel reads | **`/api/mock-draft/*` GET** with `processMemo` + private cache/ETag — **not** poll-via-`createServerFn`. |
| Vercel writes | Fluid `createServerFn` for create/join/pick/host only. Clock advance via lean cron. |

Mobile already labels the entry point **“Mock Draft Lobby”** ([`MobileMockDraftCard`](../src/components/mobile/MobileHomeSections.tsx)) but it only links to solo setup. This plan makes that label real.

---

## 0. Where to host lobbies (options ranked)

TiDB Cloud allows **up to 5 free Starter instances** per org, each with its own **~50M RU/mo + 5 GiB** pool. That is the lever for “mocks don’t steal research RUs” — not moving live traffic onto Supabase.

### Ranked options

| Rank | Option | Live lobby + picks | Separate free pool? | Verdict |
| --- | --- | --- | --- | --- |
| **1 (recommended)** | **Dedicated TiDB Starter “D – Mocks”** | `mock_draft_*` only | **Yes** — own 50M RU | Best isolation; same code patterns as native; no auth-DB coupling |
| **2** | TiDB cluster **C with native** (`native_*` + `mock_draft_*`) | Shared instance | Shared 50M with native seasons | Fine if native traffic is still low; simpler ops (one extra cluster, not two) |
| **3** | Stay on **current** TiDB (research/synced) | Same instance as warehouse | No | OK for a quiet beta only; mocks compete with research RUs |
| **4** | **Upstash Redis / Vercel KV** live + TiDB snapshot | Ephemeral KV | Depends on KV free tier | Excellent for hot state later; new vendor + ops; not required for v1 |
| **Avoid** | **Supabase Postgres** for lobby/picks | Auth project DB | No — shares 500 MB / 5 GB egress / pause with Auth | Draft polls can starve or pause the whole site |
| **Avoid as SoT** | **Supabase Realtime** (Broadcast/Presence) alone | Push only | 200 conns / 2M msgs — separate caps, still need a DB | Fan-out layer at best; not authoritative picks/clock |

### Can we “use Supabase for the lobby + TiDB for mocks”?

**Not as the best design.** Useful split of responsibilities:

| Layer | Store |
| --- | --- |
| Sign-in / host identity | **Supabase Auth** (already) |
| Live seats, clock, picks, join codes | **TiDB** (prefer dedicated Starter D) |
| Optional “My saved mocks” list | Thin Supabase **or** TiDB index rows (low churn) |
| Realtime push | Skip v1; optional later Broadcast **on top of** TiDB authority |

Putting the **lobby itself** on Supabase (rows + poll or Realtime) while picks live on TiDB doubles write paths, still burns Supabase Free (egress/connections/pause), and does not give a cleaner free-tier story than a dedicated TiDB instance.

### Recommended path

1. **Provision TiDB Starter D** for mocks (see §0.1) before multiplayer leaves quiet beta.
2. Always: **coalesce polls** on Vercel (`processMemo` + short private cache), visible-only refresh, room caps, TTL — protects **both** TiDB RUs and Fluid.
3. Keep Supabase out of the live pick path; guests never open a Supabase DB session for the room.
4. Revisit Redis/KV only if dedicated TiDB RUs still hurt under real concurrent rooms.

**Org quota note:** 5 free Starters total. Suggested map: A research · B synced/warehouse · C native · **D mocks** · (one spare).

### 0.1 Provisioning TiDB cluster D (mocks)

| Step | Detail |
| --- | --- |
| Create | TiDB Cloud → new **Starter** instance (MySQL-compatible), region near Vercel |
| Schema | Empty DB e.g. `league-office-mocks`; only `mock_draft_*` tables |
| Env | `DATABASE_URL_MOCK` (or `TIDB_MOCK_DATABASE_URL`) in Vercel + local `.env` — **never** reuse research `DATABASE_URL` |
| Code | Second pool helper beside [`tidb.ts`](../src/lib/tidb.ts): `mockTidbConfigured` / `mockTidbExecute`; migrate via admin path scoped to mock URL |
| Migrate | Extend [`tidb-migrate.server.ts`](../src/lib/tidb-migrate.server.ts) (or sibling) with `mock-draft-ddl.server.ts` statements against the mock URL only |
| Monitor | TiDB console RU chart for D alone; alert if mocks approach ~50% of monthly free RU while research is healthy |

**Important:** Cluster D **does not** reduce Vercel Fluid burn. It only isolates TiDB RUs. Poll traffic still enters through Vercel (§0.2).

### 0.2 Vercel limit burn (Hobby) — and how to cut it

Hobby allowances that mocks can hit ([Vercel Hobby](https://vercel.com/docs/plans/hobby)):

| Resource | Included | Mock risk |
| --- | --- | --- |
| **Fluid Active CPU** | **4 CPU-hrs / mo** | Highest concern historically; only **CPU execute** time (TiDB wait is mostly I/O, not Active CPU) |
| **Provisioned Memory** | 360 GB-hrs | Warm isolates holding poll traffic |
| **Function Invocations** | 1M / mo | Every poll / pick / cron hit |
| Fast Data Transfer | 100 GB | Small JSON snapshots — low |
| CDN Requests | 1M | Only if we put cacheable GETs on the edge |

**Naive anti-pattern (do not ship):** every seat polls `createServerFn(getMockDraftRoom)` every 1–2s → N invocations × draft duration, little coalescing across clients, Autopick side effects on every GET. That pattern is how a solo tester burned a large share of monthly Fluid before.

#### Rough invocation math (live draft)

Assume 4 human clients, 2s poll, 60 min draft, visible entire time:

- \(4 \times 30 \text{ polls/min} \times 60 = 7{,}200\) GETs **per room-hour**
- 10 such rooms/day × 30 days ≈ **2.2M** invocations if uncached — already over Hobby’s 1M **before** the rest of the site

With **1s `processMemo` per room** on one warm isolate: many concurrent clients collapse toward **~1 TiDB read / room / second**, but **each browser request can still count as an invocation** unless the platform serves a cached response at the edge. So we need **HTTP caching + fewer polls**, not memo alone.

#### Architecture that limits Vercel burn

```mermaid
flowchart LR
  Clients[Browsers]
  Edge["GET /api/mock-draft/room/$id\nprivate Cache-Control + ETag"]
  Memo[processMemo roomId 1s]
  Mut["POST createServerFn\npick / join / host"]
  Cron["GET /api/cron/mock-draft-tick\nCRON_SECRET ≤1/min"]
  TidbD[TiDB Starter D]
  Clients -->|"poll visible only"| Edge
  Edge --> Memo
  Memo --> TidbD
  Clients -->|"user actions only"| Mut
  Mut --> TidbD
  Cron --> TidbD
```

| Rule | Why |
| --- | --- |
| **Reads ≠ Fluid `createServerFn`** | Use Nitro **`/api/mock-draft/room/$roomId`** (and `/recap/$shareId`) like [`/api/data/league/$id`](../src/routes/api/data/league.$id.ts): `processMemo` + `Cache-Control: private, max-age=1–2` (or 2–3 lobby) + **ETag** / `If-None-Match` → cheap 304 when unchanged |
| **Mutations = Fluid OK** | `create` / `join` / `pick` / `hostControl` stay `createServerFn` — rare, user-driven |
| **GET is read-mostly** | Do **not** run autopick as a side effect on every poll. Advance clock via **cron tick** (and optionally on pick POST if deadline already passed). Keeps GETs cacheable |
| **Visible-only polls** | [`visibleRefetchInterval`](../src/lib/page-visibility.ts); hidden tabs = 0 invocations |
| **Slower cadence** | Lobby **3s**; live **2s** (not 1s); after complete → **stop** polling, fetch snapshot once |
| **One snapshot payload** | Never N calls per seat/player |
| **Cron lean** | Actions → `/api/cron/mock-draft-tick` ≤1/min globally; batch due rooms; same `CRON_SECRET` pattern as other crons |
| **Caps** | Concurrent rooms/host, rooms/day, max humans — bound worst-case invocation rate |
| **ssr: false** on room routes | Avoid SSR Fluid waterfalls on navigation |
| **No prefetch of mock APIs** | Intent preload must not hit room endpoints |
| **Long-term** | Move cron/tick worker off Vercel (Coolify/Oracle — free-tier Phase 1) so draft clock doesn’t compete with Hobby Active CPU |

#### What still burns Active CPU (acceptable)

- JSON parse/serialize of room snapshot on cache miss
- Guest-token / JWT verify on mutations
- Pick transaction + AI pick CPU on timeout (cron / pick path — infrequent)

#### What we are optimizing away

- Per-client Fluid RPC polls
- Autopick SQL on every GET
- Background polls in hidden tabs
- Recap polling after complete
- Fan-out per seat

**Bottom line:** Dedicated TiDB D protects **research RUs**. Vercel survival depends on **HTTP-cached coalesced GETs + mutation-only Fluid + slow visible polls + cron clock**, not on which TiDB cluster holds the rows.

### 0.3 Worked example — 10 humans, 2 hours

Assumptions (worst-case humans, planned cadence):

| Knob | Value |
| --- | --- |
| Seats | **10 humans**, all tabs **visible** entire time |
| Duration | **2 hours** live (ignore short lobby) |
| Poll | **every 2s** → `GET /api/mock-draft/room/$id` |
| Roster | Default 15 rounds → **150 picks** |
| Cron | **1/min** during the window |
| Setup | 1 create + 9 joins + 1 start = **11** mutations |

#### Request counts (this one room)

| Traffic | Formula | Count |
| --- | --- | --- |
| Room GETs (origin, no browser cache help) | \(10 \times (3600/2) \times 2\) | **36,000** |
| Pick POSTs | 150 | **150** |
| Setup POSTs | 11 | **11** |
| Cron ticks (shared global; attributed here) | \(2 \times 60\) | **120** |
| Recap GET after complete | ~10 once | **~10** |
| **Total function invocations (upper)** | | **~36.3k** |

With `Cache-Control: private, max-age=2` + ETag, many polls become **304** or browser cache hits. Treat **~15k–36k** origin hits as the realistic band (304s still often count as invocations but are cheaper on Active CPU / TiDB).

#### Vs monthly free limits (this room alone)

| Limit | Free pool | This 10×2h draft | Share of monthly |
| --- | --- | --- | --- |
| Vercel **invocations** | 1,000,000 | ~36k (upper) | **~3.6%** |
| Vercel **Active CPU** | 4 CPU-hrs | Mostly I/O wait; estimate **~0.05–0.2 CPU-hrs** if ~5–20ms CPU/GET on miss + cheap 304s | **~1–5%** |
| Vercel **provisioned memory** | 360 GB-hrs | One/few warm isolates for 2h — small | **≪1%** typically |
| Vercel **data transfer** | 100 GB | Snapshot ~5–30 KB × 36k ≈ **0.2–1 GB** upper | **~0.2–1%** |
| TiDB D **RUs** | 50,000,000 | Memoized: ~1 read/room/s × 7200s ≈ 7k TiDB loads + 150 pick writes; ballpark **low hundreds of thousands RU** (order-of-magnitude; depends on row bytes) | **≲1%** typical |
| TiDB D **storage** | 5 GiB | One room + snapshot ≪ 1 MB | negligible |
| Supabase | Auth only | 10 sessions / JWTs | negligible |

**How many such drafts fit in a month (mocks-only ceiling, ignoring rest of site)?**

| Resource | Rough capacity at this shape |
| --- | --- |
| Invocations | \(1\text{M} / 36\text{k} ≈\) **~25–30** full 10-human × 2h rooms (if every poll hits origin) |
| Active CPU | Often **higher** than invocations if GETs stay I/O-light — tens of rooms before CPU is the bottleneck |
| TiDB D RUs | **Hundreds** of rooms before 50M is the story — Vercel invocations hit first |

So for this plan, **Vercel invocations (then Active CPU) gate scale**, not TiDB D. Mixed with the rest of the site (research CDN misses, ESPN Fluid, crons), budget **a handful of busy multiplayer rooms per day**, not unlimited open lobbies.

#### Same draft, lighter variants

| Variant | Approx origin GETs | Notes |
| --- | --- | --- |
| 10 humans × 2h × 2s (above) | ~36k | Worst |
| 4 humans + 6 AI × 2h × 2s | ~14.4k | Typical “friends + bots” |
| 10 humans, half tabs hidden half the time | ~18k | Visibility helper |
| Poll live at **3s** instead of 2s | ~24k | Easy dial if invocations climb |

---

## 1. Current state

| Surface | Route | Authority | Notes |
| --- | --- | --- | --- |
| Solo Mock Draft | `/mock-draft/setup` → `/mock-draft` | Browser `useState` + `sessionStorage` config | AI loop + pick clock in [`mock-draft.tsx`](../src/routes/mock-draft.tsx); math in [`draft.ts`](../src/lib/draft.ts); AI in [`mock-ai.ts`](../src/lib/mock-ai.ts) |
| War Room | `/draft` | `localStorage` via [`use-draft.ts`](../src/hooks/use-draft.ts) | Manual board; no clock / AI |
| Native draft | `/league/$linkId/draft` | TiDB + Fluid | Offline commissioner assign; live clock deferred |

Reusable as-is: snake/linear `teamForPick`, roster helpers, `aiPick` / personas, `DraftBoard`, `PlayerList`, `MyTeamColumn`, `MockRecap`, setup form fields from [`mock-config.ts`](../src/lib/mock-config.ts).

Gaps for multiplayer: no room id, no shared picks, no server clock, no seat claims, no join-by-code, no conflict-safe pick endpoint.

---

## 2. Product UX

### 2.1 Entry

Extend setup into a **lobby hub** (desktop + mobile):

1. **Solo practice** — existing flow (unchanged).
2. **Host a room** — requires sign-in; configures league size, scoring, roster, snake/linear, pick timer (reuse `MockConfig` fields); host claims a draft slot; server returns `roomId` + short `joinCode`.
3. **Join with code** — open to anyone; enter code + display name; claim an open human seat (or wait if full).

Routes (proposed):

| Route | Purpose |
| --- | --- |
| `/mock-draft/setup` | Hub: Solo / Host / Join (keep current solo form; add mode switcher) |
| `/mock-draft/room/$roomId` | Lobby + live arena (same shell; lobby until host starts) |
| `/mock-draft/join?code=` | Deep link → claim seat → redirect to room |

Share link format: `/mock-draft/join?code=ABCD12` (code also shown large in lobby for verbal share).

### 2.2 Lobby (pre-start)

- Seat grid: slot 1…N with display name, `human` | `open` | `ai`, ready flag (optional v1: host-only start, no ready check).
- Host controls: kick seat, fill empty with AI / leave open until start (open seats become AI on start), change timer/settings until `status=live`, **Start Draft**.
- Non-hosts: rename self, leave seat, wait.
- Poll lobby state while visible (~2–3s).

### 2.3 Live draft

Reuse the solo arena chrome (Broadcast theme, board / players / my team tabs):

- Server owns picks, `current_pick`, `pick_deadline_at`, pause flag.
- Client shows countdown from `pick_deadline_at` (wall clock), not a local `setInterval` authority.
- On your turn: Draft buttons enabled; others greyed (`canDraft` already exists on `PlayerList`).
- Empty / AI seats: server AI tick (cron + pick-on-read) using existing `aiPick` personalities.
- Human timeout: `autoPickForUser`-equivalent on server (ADP / needs).
- Host: pause / resume / force-pick current seat.
- Complete → existing `MockRecap` fed from room picks (grades stay client-side; no season write).

### 2.4 Guest vs signed-in joiners

| Actor | Identity | Create room | Pick / claim seat |
| --- | --- | --- | --- |
| Host | Supabase `user_id` | Yes | Yes |
| Signed-in joiner | Supabase `user_id` | No | Yes |
| Guest joiner | Opaque `guest_id` + HMAC `guest_token` (httpOnly cookie or returned secret stored in `sessionStorage`) | No | Yes, token required |

Guests never hit `requireSupabaseAuth`. Join and pick endpoints accept either a valid Bearer session **or** a valid guest token for that `room_id` + `seat_id`.

Abuse caps: rate-limit join-by-code; max concurrent open rooms per host; room TTL (see §7).

---

## 3. Architecture

```mermaid
flowchart LR
  subgraph clients [Browsers]
    Host[Host signed in]
    Guest[Guest or member]
  end
  subgraph vercel [Vercel]
    Mut[Fluid createServerFn mutations]
    Read["API GET /api/mock-draft/room\nmemo + ETag"]
    Cron["/api/cron/mock-draft-tick"]
  end
  subgraph tidb [TiDB Starter D]
    Rooms[mock_draft_rooms]
    Seats[mock_draft_seats]
    Picks[mock_draft_picks]
  end
  Host -->|Bearer JWT| Mut
  Guest -->|guest_token or JWT| Mut
  Host -->|poll visible| Read
  Guest -->|poll visible| Read
  Mut --> Rooms
  Mut --> Seats
  Mut --> Picks
  Read --> Rooms
  Cron --> Rooms
  Cron --> Picks
```

**Why Fluid for mutations only:** credentials, guest-token verification, and `FOR UPDATE` pick serialization — same pattern as native league ops ([`native-league.functions.ts`](../src/lib/native-league.functions.ts)). Polling via Fluid would burn Hobby Active CPU / invocations (§0.2).

**Why not hitch to `native_*`:** rooms are ephemeral practice; no rosters/schedules/standings; different auth (guests); different lifecycle; **separate TiDB D**. Reuse **code** (`draft.ts`, `mock-ai.ts`, UI), not tables.

**Why polling (not Realtime):** matches native §6.6 and free-tier posture. Lobby ~3s; live ~2s while visible; backoff when hidden via [`page-visibility.ts`](../src/lib/page-visibility.ts) / `visibleRefetchInterval`. Draft clock advances via **cron tick** (≤1/min) + deadline check on pick POST — not autopick-on-every-GET.

---

## 4. Data model (TiDB)

New tables (add to [`native-league-ddl.server.ts`](../src/lib/native-league-ddl.server.ts) sibling module e.g. `mock-draft-ddl.server.ts` + [`scripts/tidb/schema.sql`](../scripts/tidb/schema.sql); apply via existing TiDB migrate).

```
mock_draft_rooms
  id CHAR(36) PK
  join_code VARCHAR(8) UNIQUE NOT NULL     -- short share code
  host_user_id VARCHAR(36) NOT NULL
  status ENUM('lobby','live','paused','complete','expired') NOT NULL DEFAULT 'lobby'
  team_count TINYINT NOT NULL
  scoring_preset VARCHAR(16) NOT NULL      -- std|half|ppr
  roster_slots JSON NOT NULL
  draft_order_type ENUM('snake','linear') NOT NULL DEFAULT 'snake'
  pick_time_limit_sec INT NULL             -- null = no clock
  playoffs_start_week TINYINT NOT NULL DEFAULT 15
  draft_order JSON NULL                    -- optional custom slot order
  current_pick INT NOT NULL DEFAULT 0      -- 0 in lobby; 1..total when live
  pick_deadline_at DATETIME NULL
  settings_version INT NOT NULL DEFAULT 1
  expires_at DATETIME NOT NULL             -- hard TTL from create
  created_at / updated_at

mock_draft_seats
  room_id CHAR(36) NOT NULL
  seat_slot TINYINT NOT NULL                -- 1..team_count
  kind ENUM('open','human','ai') NOT NULL DEFAULT 'open'
  user_id VARCHAR(36) NULL                 -- signed-in claim
  guest_id VARCHAR(36) NULL                -- guest claim
  display_name VARCHAR(64) NOT NULL
  persona VARCHAR(32) NULL                 -- AI personality when kind=ai
  guest_token_hash CHAR(64) NULL           -- sha256 of guest secret
  connected_at DATETIME NULL              -- last successful poll/heartbeat
  PRIMARY KEY (room_id, seat_slot)
  UNIQUE KEY uq_mock_seat_user (room_id, user_id)
  UNIQUE KEY uq_mock_seat_guest (room_id, guest_id)

mock_draft_picks
  room_id CHAR(36) NOT NULL
  pick_number INT NOT NULL
  round TINYINT NOT NULL
  seat_slot TINYINT NOT NULL
  player_id VARCHAR(32) NOT NULL
  source ENUM('manager','autopick','ai','host_force') NOT NULL
  intent_id VARCHAR(36) NULL               -- client idempotency
  picked_at DATETIME NOT NULL
  PRIMARY KEY (room_id, pick_number)
  UNIQUE KEY uq_mock_pick_player (room_id, player_id)
  UNIQUE KEY uq_mock_pick_intent (room_id, intent_id)
```

No Supabase mirror. Catalog / ADP still from existing client players catalog + snap-cdn (no Fluid public reads).

---

## 5. Server API

Module sketch: `src/lib/mock-draft-lobby.server.ts` (TiDB D pool) + `src/lib/mock-draft-lobby.functions.ts` (mutations) + `src/routes/api/mock-draft/room.$roomId.ts` (reads).

### 5.1 Mutations — Fluid `createServerFn`

| RPC | Auth | Behavior |
| --- | --- | --- |
| `createMockDraftRoom` | `requireSupabaseAuth` | Insert room + seats on **TiDB D**; host seat = human; return `{ roomId, joinCode, seatSlot, shareId }` |
| `joinMockDraftRoom` | Optional auth | Resolve code → lock room → claim open seat; if no JWT, mint `guest_id` + token; return room + seat + token |
| `leaveMockDraftRoom` | JWT or guest token | Free seat if `lobby`; refuse mid-pick unless host reassigns |
| `updateMockDraftLobby` | Host JWT | Settings / fill AI / kick (lobby only) |
| `startMockDraft` | Host JWT | `status=live`, `current_pick=1`, set deadline, materialize open→ai |
| `pickMockDraftPlayer` | JWT or guest token; must own current seat | `FOR UPDATE` room row; if deadline passed, autopick prior seat first; verify turn + player free; insert pick; advance cursor + deadline; idempotent on `intent_id` |
| `hostMockDraftControl` | Host JWT | pause / resume / force-pick / undo last (v1: undo only before next pick lands) |

### 5.2 Reads — `/api/mock-draft/*` (not Fluid polls)

| Route | Auth | Behavior |
| --- | --- | --- |
| `GET /api/mock-draft/room/$roomId` | Bearer **or** `x-mock-guest-token` (seat must belong to room) | Read-only snapshot: room, seats, picks, `serverNow`, `etag`; `processMemo(roomId, ~1000ms)`; `Cache-Control: private, max-age=1–2`; honor `If-None-Match` |
| `GET /api/mock-draft/recap/$shareId` | None | Completed `result_snapshot` only; longer private/public cache (e.g. max-age=60) |

### 5.3 Cron

`GET /api/cron/mock-draft-tick` (`CRON_SECRET`) — scan due `live` rooms on TiDB D; autopick/AI for passed deadlines; expire rooms; purge old snapshots. **≤1/min.** This is the primary clock/AI driver so room GETs stay cacheable.

Guest token: `HMAC-SHA256(roomId|guestId|seatSlot, MOCK_DRAFT_GUEST_SECRET)` (or sealed payload). Store only hash on seat; client keeps raw token (header on GET/POST).

---

## 6. Pick / clock correctness

Mirror native §6.4 without sharing tables:

1. `BEGIN`
2. `SELECT … FROM mock_draft_rooms WHERE id=? FOR UPDATE`
3. Assert `status=live`, actor owns `teamForPick(current_pick)`, player not in `mock_draft_picks`
4. Insert pick; `current_pick += 1`; set `pick_deadline_at = now + limit` (or null); if past total picks → `complete`
5. `COMMIT`
6. On conflict / wrong turn → `409` with fresh snapshot

**Timeout path (cron + pick POST):** if `now > pick_deadline_at`, `/api/cron/mock-draft-tick` (and `pickMockDraftPlayer` if a human acts late) performs autopick/AI under the same lock. Room GET stays read-only so responses can be memoized/304’d. Clients never “decide” the pick locally.

AI seats: reuse [`aiPick`](../src/lib/mock-ai.ts) with seat `persona` (server import of shared pure helpers — already used by [`native-league-ai.server.ts`](../src/lib/native-league-ai.server.ts)).

---

## 7. Free-tier / lifecycle guardrails

| Rule | Value |
| --- | --- |
| Max rooms created per user / day | e.g. 10 |
| Max concurrent `lobby`+`live` rooms per host | e.g. 3 |
| Team count | 8–16 (match solo `TEAM_CHOICES`) |
| Room TTL | 6h from create; extend +2h while `live` and any seat polled in last 10m |
| Lobby poll | **3s** visible only → `/api/mock-draft/room/$id` |
| Live poll | **2s** visible only; pause when hidden |
| Cron tick | ≤1/min; clock + AI + expiry (not per-visitor) |
| Complete retention | On complete: write `result_snapshot` JSON; keep **7–14 days**; stop room polls; recap uses `/api/mock-draft/recap/$shareId` |
| Share links | Opaque `share_id` (not join code); read-only; no auth required |
| In-progress rooms | Private API GET (guest token or JWT) — **not** public snap-cdn; **not** Fluid poll |

Do **not** fan out N calls per seat. One room GET returns the full snapshot. Do **not** poll via `createServerFn`.

---

## 8. Results, share, and export

On `status=complete`, server freezes a **compact snapshot** (settings, seat names, ordered picks with player id/name/pos/team, timestamps). Live polling stops; recap/share read the snapshot only.

| Feature | How | Limit impact |
| --- | --- | --- |
| **Recap page** | `/mock-draft/recap/$shareId` (or `?share=`) — read-only board + existing [`MockRecap`](../src/components/draft/MockRecap.tsx) | One Fluid GET; cacheable short private TTL |
| **Copy link** | Host/any seat copies share URL after complete (and optionally while live: “spectator link” = room id + read token — defer) | None |
| **Export JSON** | Download snapshot file from client | Zero server storage beyond snapshot |
| **Export CSV** | One row per pick: overall, round, seat, player, pos, team, source | Client-side |
| **Export text board** | Plaintext round-by-round for Discord/Reddit paste | Client-side |
| **Save to account** (phase 3+) | Signed-in only: insert thin Supabase or TiDB “my mocks” row keyed by `share_id` | Low churn; cap e.g. 20 saves/user |
| **Import to War Room** (phase 3+) | “Load my seat’s roster into War Room / sandbox” from snapshot — local only | No TiDB write |

Do **not** publish per-room JSON to the `snap-cdn` branch (orphan CDN is for shared public data, not private boards).

Schema add on `mock_draft_rooms` (or side table):

```
share_id CHAR(26) UNIQUE NULL      -- set at create or on complete
result_snapshot JSON NULL          -- frozen on complete
result_expires_at DATETIME NULL
```

---

## 9. Feature ideas from other mock platforms (prioritized)

Common elsewhere (FantasyPros Draft Wizard, Sleeper mocks, ESPN/Yahoo mocks, RTSports, etc.) mapped to us:

### Ship with multiplayer v1 (or immediately after live)
- **Private room + join code** (locked) + AI fillers
- **Pick queue** per seat (draft from queue / autopick from queue on timeout) — schema cousin of `native_draft_queues`
- **Host pause / force-pick / kick**
- **Pick clock** with visible deadline
- **Post-draft grades / recap** (already have `MockRecap`) + **share link + CSV/JSON**
- **Restart with same settings** (new room, same config)
- **Reach / value vs ADP** toggle (solo currently hides tags in live mock — offer “show ADP delta” for practice)

### Strong v1.5
- **Pre-draft rankings / watchlist sync** from War Room watch list
- **Positional needs / scarcity** strip (starters filled vs remaining ADP at position)
- **Spectator / late join read-only** after start
- **Custom draft order** drag in lobby (solo already has `customOrder` concepts in places)
- **Keeper pre-loads** (mark kept players before start — practice for keeper leagues)
- **Slow / hyper / no-timer** speeds (solo has speed already — host setting)

### Later / nice-to-have (do not block lobbies)
- Public open matchmaking lobby browser
- In-draft chat or emoji reactions
- In-draft trades
- Auction / salary-cap mocks
- Upload custom rankings CSV
- Historical “my mock archive” beyond 14-day snapshot
- Voice rooms
- ELO / leaderboards for public mocks

**Non-goals remain:** hitching results into native season rosters; Realtime; auction in v1.

---

## 10. UI implementation notes

- Preserve SiteNav + ScoreTicker via root layout; Broadcast tokens; no new theme.
- Split solo page logic: extract shared arena presentational pieces from [`mock-draft.tsx`](../src/routes/mock-draft.tsx) into something like `components/draft/MockDraftArena.tsx` that accepts either local controllers (solo) or room snapshot + mutation callbacks (multiplayer).
- Lobby seat strip above the arena (or replace players tab until start).
- Wire `PlayerModalHost` draft overrides to `pickMockDraftPlayer` with `intent_id` (uuid per click).
- Mobile: update `MobileMockDraftCard` to hub (Host / Join / Solo); room route under existing desktop shell first; `/m/mock-draft/...` can follow if needed.
- Auth gate on Host: reuse `AuthDialog`; Join stays open with display-name field.
- After complete: share URL + Export menu (JSON / CSV / plaintext) on recap.

---

## 11. Phased rollout

### Phase 0 — TiDB D + server skeleton
1. Create TiDB Starter D; wire `DATABASE_URL_MOCK` + `mockTidbExecute`.
2. DDL for `mock_draft_*` (include `share_id` / `result_snapshot`); migrate against D only.
3. Mutations: create / join; GET `/api/mock-draft/room/$id` with memo/ETag; guest token helpers; caps.
4. No UI yet beyond smoke.

### Phase 1 — Lobby UX
1. Setup hub: Solo | Host | Join.
2. Room lobby page: seats, share code/link, host start, polling.
3. Deep link `/mock-draft/join?code=`.

### Phase 2 — Live multiplayer draft
1. `pickMockDraftPlayer` + turn gating wired to existing board/list.
2. Server clock + autopick on timeout; host pause/force.
3. AI fill for empty seats; complete → freeze snapshot → `MockRecap` + share/export.

### Phase 3 — Polish
1. Cron tick + expiry sweeper Actions workflow (live TTL + result retention).
2. Kick / reconnect / seat transfer; display names from profiles when signed in.
3. Pick queues; mobile lobby parity; rate-limit hardening; optional “save to account” / War Room import.
4. Basic observability (pick latency, active room count, RU proxies).

**Non-goals for v1:** auction, public open matchmaking browser, voice/chat, ranking/ELO, persisting mock results into native season leagues, hitching to native live snake, Supabase Realtime.

---

## 12. Explicit separation from native live snake

| | Mock lobby | Native live snake (later) |
| --- | --- | --- |
| Tables | `mock_draft_*` | `native_leagues` / `native_draft_picks` |
| After draft | Snapshot recap + share; TTL purge | Rosters + schedules + in-season |
| Guests | Allowed with token | Members only |
| Entry | `/mock-draft/...` | `/league/$linkId/draft` |

Shared libraries only: `draft.ts`, `mock-ai.ts`, draft UI components. When native live ships, it can copy the pick-lock / deadline / polling patterns from this plan — not the room rows.

---

## 13. Testing checklist

- Host create → join code works for signed-in and guest in two browsers.
- Double-click pick / retry with same `intent_id` → one pick.
- Two clients race different players on same turn → one `409`, board converges.
- Timer expiry → autopick without client write.
- AI seats advance without human action.
- Hidden tab stops polling; visible resume catches up via get snapshot.
- Room past `expires_at` rejects joins/picks.
- Solo `/mock-draft` path unchanged regression.
