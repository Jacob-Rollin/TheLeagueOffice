# TiDB warehouse cutover

Player analytics warehouse and brain hydration are **TiDB-only**. Supabase
project **league-office-brain** (Database B) is retired — safe to pause/delete
after this deploy is live and `/api/data/players-export` returns ~4000+ rows.

Auth, profiles, invite codes, and site tables stay on **Supabase Database A**
(`VITE_SUPABASE_URL` / `SUPABASE_*`).

## What you already did
- Put `DATABASE_URL` on Vercel (Production + Preview) and redeployed.

Production currently connects even if the URL ends in `/sys` or `/test` — the app
rewrites that to the `league-office-native` schema automatically. Prefer fixing the
URL path to `/league-office-native` in the TiDB console copy when you can.

## Prerequisites
1. **`DATABASE_URL`** on Vercel Production (+ Preview).
2. **`CRON_SECRET`** on Vercel **and** as a GitHub Actions secret (same value).
3. **`APP_URL`** GitHub secret = `https://www.theleagueoffice.app` (use **www**).

You do **not** need `VITE_SUPABASE_URL_B` / `VITE_SUPABASE_ANON_KEY_B` anymore.
Remove them from Vercel when convenient (optional; unused after this cutover).

---

## Seed / refresh (pick ONE)

Empty TiDB is seeded from a **live harvest** (Sleeper + FantasyCalc + LeagueLogs),
not from Supabase B.

### Option A — GitHub Actions
1. Open **Actions** → **TiDB Warehouse Migrate**.
2. Click **Run workflow**.
3. Leave action = `migrate`.
4. Run. The job POSTs migrate, then checks `/api/data/players-export`.

### Option B — Terminal
```sh
export APP_URL="https://www.theleagueoffice.app"
export CRON_SECRET="paste-from-vercel-here"

curl -fsSL -X POST "$APP_URL/api/admin/tidb-migrate" \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"action":"migrate"}'
```

You want JSON with `"ok":true` and a `seed.total` / `status.playerWarehouseCount` around **4000+**.

Daily refresh: cron `/api/cron/warehouse-ingest` (no Supabase B).

---

## Verify

```sh
export APP_URL="https://www.theleagueoffice.app"
export CRON_SECRET="paste-from-vercel-here"

curl -fsSL -H "Authorization: Bearer $CRON_SECRET" "$APP_URL/api/admin/tidb-migrate"
# expect: "playerWarehouseCount": 4000+

curl -fsSL "$APP_URL/api/data/players-export" | head -c 200
# expect: {"ok":true,"v":7,...}
```

Client path: snap-cdn `players-export.json` → else `/api/data/players-export` → else local catalog.
No calls to `league-office-brain`.

---

## After it works — pause Database B

1. Confirm Production has this cutover build.
2. Confirm `playerWarehouseCount` ≥ ~4000 and players-export is healthy.
3. In Supabase dashboard, **pause** (or delete) **league-office-brain**.
4. Optionally delete Vercel env vars `VITE_SUPABASE_URL_B` and `VITE_SUPABASE_ANON_KEY_B`.

There is no rollback to Supabase B in app code. If TiDB is down, warehouse
ingest fails closed; clients soft-empty / use local catalog.
