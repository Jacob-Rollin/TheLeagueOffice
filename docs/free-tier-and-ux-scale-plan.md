# Free-Tier Scale + Smooth UX Plan

Living plan for staying on free tiers while expanding users, keeping live scoring / research fresh, and making pages feel as fast as FantasyPros-style tools (instant tables, minimal blank loading).

**Status:** planning — implement incrementally alongside feature work  
**Last updated:** 2026-10-09  
**Related:** `.cursorrules` (Free-Tier Guardrails), `docs/snap-cdn-setup.md`, `docs/native-leagues-plan.md`

---

## 1. Current architecture (keep this)

```
Browser → IndexedDB / Sleeper APIs / snap-cdn
       → /api/data/* (TiDB SELECT + CDN Cache-Control)
       → Fluid createServerFn only for secrets, writes, cron
```

Warm path (not browse):

```
GitHub Actions → APP_URL + CRON_SECRET → /api/cron/*
             → Publish Snap CDN (orphan snap-cdn branch)
```

**Do not regress:** research/trade/waiver `ssr: false`, no `refetchOnWindowFocus` on heavy queries, Sleeper client-first, snap-cdn before Vercel, soft-empty in prod (no Fluid fallthrough).

---

## 2. Free-tier burn map (priority)

| Priority | Risk | Notes |
|---|---|---|
| P0 | Background Fluid on Vercel | Gameday delta (ESPN), research-aggregates, planning snaps, warehouse |
| P0 | Matchup Replay request-path nflverse | Worst on-demand Fluid bomb |
| P1 | ESPN/Yahoo concurrent playbook users | Delta + credentialed boards still Fluid |
| P1 | Missing / broken `VITE_SNAP_CDN_BASE` | Everyone hits Vercel → TiDB |
| P2 | raw.githubusercontent.com scale | Fine ~20 users; not a real CDN |
| P2 | Single TiDB for warehouse + research + synced + native | RU contention as native grows |

---

## 3. Infra sequence (Coolify / Oracle / extra TiDB)

Implement as capacity pressure appears — not all at once.

### Phase 1 — Cron/admin worker (biggest Fluid win)
- **Move to Coolify or Oracle:** `/api/cron/*`, ATP warm, snap compute, `/api/admin/tidb-migrate`, warehouse ingest
- **Keep on Vercel:** UI, auth, `/api/data/*` CDN reads, ESPN credentialed Fluid (for now)
- Retarget GitHub Actions `APP_URL` to the worker

### Phase 2 — Split TiDB free clusters
| Cluster | Tables |
|---|---|
| A – Research | `agg_*` |
| B – Synced / warehouse | `player_warehouse`, `synced_*` |
| C – Native | `native_*` |

Start with A + B; add C when native leagues see real traffic.

### Phase 3 — Product host splits (optional)
| Slice | Host | Shared |
|---|---|---|
| Research + tools | Coolify/Oracle + snap CDN | Auth via Supabase |
| Playbook / live scoring | Vercel (or Coolify later) | `league_connections` |
| Native leagues | Separate Coolify + TiDB C | `native_league_links` |

### Phase 4 — Full off-Vercel (only if still Fluid-bound)
- Nitro on Coolify/Oracle + Cloudflare (or similar) in front
- Bigger lift: cookies, SSR, `NITRO_PRESET`

### Quick wins (no host move)
1. Matchup Replay off request-path nflverse (precompute/cache like research)
2. Confirm Production `VITE_SNAP_CDN_BASE` + green Publish Snap CDN
3. Trim gameday ESPN delta frequency / limit vs Sleeper
4. Cap full research-aggregates cadence; keep ATP-only Mon–Fri
5. When >~20 concurrent: move snap JSON to R2 or Coolify static CDN

---

## 4. FantasyPros patterns → our free-tier equivalents

What FantasyPros-style sites do well (from public stack / page behavior):

| Pattern | FantasyPros-ish | Our free-tier approach |
|---|---|---|
| Data ready on first paint | Server-rendered HTML tables + embedded `ecrData` blobs | Prefetch snap-cdn JSON into RQ/IndexedDB **before** navigation; show last-good data instantly |
| Edge CDN for static data | `cdn.fantasypros.com` (CloudFront/S3) | snap-cdn today → R2/Coolify static later |
| Heavy tools on subdomains | e.g. draftwizard subdomain | Research worker / native app splits (Phase 1–3) |
| Filter/sort without reload | Client table over already-loaded rows | Keep full payload client-side; sort/filter in memory (already true for many research pages) |
| No blank “Loading…” flash | Content skeleton or previous rows stay visible | `placeholderData: (prev) => prev` everywhere; layout skeletons; never unmount table on refetch |
| Asset CDN | Separate CDN host | Keep fonts/images lean; prefer snap/R2 for JSON |

**We should not** copy paid SSR-everything onto Fluid — that burns Hobby CPU. We copy the *feel*: instant chrome + stale-while-revalidate data from a public CDN.

---

## 5. Smooth UX backlog (implement alongside features)

Ship these whenever touching related routes. Prefer small PRs.

### A. Instant navigation (no blank screens)
- [ ] Enable TanStack Router **intent preload** on research / playbook nav links (`preload="intent"`)
- [ ] On app shell / home: idle-prefetch top research snaps (FPA, leaders, ATP, injury) from snap-cdn only
- [ ] Persist React Query research cache to IndexedDB (stale-while-revalidate across visits)
- [ ] Expand `placeholderData: (prev) => prev` to all research + league board queries that still blank on load
- [ ] Replace text “Loading…” with **layout-matching skeletons** (table chrome visible immediately)

### B. Faster stats / tables
- [ ] Prefetch all three scoring formats (std/half/ppr) after first research hit — format toggle = cache hit, no spinner
- [ ] Virtualize long tables (leaders, redzone, targets) when row count is large
- [ ] Defer non-critical below-fold widgets; paint primary table first
- [ ] Keep filter/sort/position tabs fully client-side after one snap fetch

### C. Live scoring smoothness
- [ ] Sleeper: keep browser polls; pause when `document.hidden` (already via page-visibility — don’t regress)
- [ ] Show last matchup scores immediately from RQ/IndexedDB while soft-refreshing
- [ ] ESPN: prefer TiDB CDN boards; never block first paint waiting on Fluid
- [ ] Avoid full-page remounts on week change — swap data in place (`placeholderData` / deferred values)

### D. Perceived performance
- [ ] Optimistic UI for lineup/waiver/native mutations where safe
- [ ] Prefetch player detail on row hover (draft list already does some of this — extend to research/waiver)
- [ ] Soft transitions (`startTransition` / `useDeferredValue`) for search filters (native players already uses deferred query)
- [ ] Ensure ScoreTicker / navbar never wait on research or league Fluid

### E. Free-tier safety while doing UX work
- Prefetch **only** snap-cdn / public Sleeper / already-warm CDN URLs — never prefetch Fluid `createServerFn`
- Cap idle prefetch concurrency (1–2 at a time)
- No shorter CDN TTLs “for speed” — that increases TiDB RUs; use client cache instead
- No request-path scrapes for snappier UX

---

## 6. “As we go” implementation rule

When a PR touches a surface, also apply the matching UX/free-tier item:

| If you touch… | Also do… |
|---|---|
| Research page | `placeholderData`, skeleton, format prefetch, intent preload |
| Matchup / My Team | Last-good scores on paint; no Fluid on first paint |
| Matchup Replay | Move nflverse off request path |
| Cron / warm workflow | Prefer Coolify worker URL when Phase 1 exists |
| Native leagues | Keep writes on dedicated path; don’t couple to research TiDB |
| Nav / shell | Intent preload + idle snap prefetch |

---

## 7. Success metrics (practical)

- Research first paint shows table chrome or previous data in **&lt;100ms** of navigation (from cache) when user has visited before
- Cold research load = **one** snap-cdn GET, no Vercel if base set
- Sleeper live scoring: no Fluid in prod network tab
- Monthly Fluid: dominated by worker/cron after Phase 1, not by browse
- TiDB RUs: flat as concurrent Sleeper users grow

---

## 8. Out of scope (for later)

- CAPTCHA / Turnstile (security track)
- Full Auth Hook invite enforcement (security track)
- FantasyPros-style paid expert consensus data
- Shortening research CDN TTLs for “fresher” feel (hurts free tier — use cron cadence instead)
