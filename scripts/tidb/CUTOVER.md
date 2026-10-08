# TiDB warehouse cutover

## What you already did
- Put `DATABASE_URL` on Vercel (Production + Preview) and redeployed.

Production currently connects even if the URL ends in `/sys` or `/test` — the app
rewrites that to the `league-office-native` schema automatically. Prefer fixing the
URL path to `/league-office-native` in the TiDB console copy when you can.

## Prerequisites still needed
1. **Merge PR #19** (or keep this branch deployed) so `/api/admin/tidb-migrate` exists on production. Without it, migrate returns **404**.
2. **`CRON_SECRET`** on Vercel **and** as a GitHub Actions secret (same value).
3. **`APP_URL`** GitHub secret = `https://www.theleagueoffice.app` (use **www** — apex redirects and the Action would only see “Redirecting…”).

---

## Step 3 — Run migrate (pick ONE)

### Option A — Open players-export (no secret needed)
After Production has this build, open:

`https://www.theleagueoffice.app/api/data/players-export`

The first request auto-creates tables and seeds from the Supabase brain. Wait for JSON starting with `{"ok":true,"v":7`.

### Option B — GitHub Actions
1. Open **Actions** → **TiDB Warehouse Migrate**.
2. Click **Run workflow**.
3. Leave action = `migrate`.
4. Run. The job POSTs migrate, then checks `/api/data/players-export`.

If the workflow errors about missing secrets, add under
**Settings → Secrets and variables → Actions**:
- `APP_URL` = `https://www.theleagueoffice.app`
- `CRON_SECRET` = same value as Vercel → Settings → Environment Variables → `CRON_SECRET`

### Option C — Terminal (Mac/Linux)
Copy your `CRON_SECRET` from Vercel, then run:

```sh
export APP_URL="https://www.theleagueoffice.app"
export CRON_SECRET="paste-from-vercel-here"

curl -fsSL -X POST "$APP_URL/api/admin/tidb-migrate" \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"action":"migrate"}'
```

You want JSON with `"ok":true` and a `seed.total` / `status.playerWarehouseCount` around **4000+**.

If you get **404**, PR #19 is not on that deployment yet — merge it and wait for Vercel Production.
If you get **401** / curl exit **22**, GitHub `CRON_SECRET` ≠ Vercel Production `CRON_SECRET` (or Production is missing it). Re-copy from Vercel → Environment Variables → Production → `CRON_SECRET` into GitHub Actions secrets (no quotes).
If you get **503** `DATABASE_URL not configured`, add the env var to **Production** (not only Preview) and redeploy.

---

## Step 4 — Verify

```sh
export APP_URL="https://www.theleagueoffice.app"
export CRON_SECRET="paste-from-vercel-here"

# Row count / health
curl -fsSL -H "Authorization: Bearer $CRON_SECRET" "$APP_URL/api/admin/tidb-migrate"
# expect: "playerWarehouseCount": 4000+
# expect (after native leagues DDL ships): "nativeLeagues": { "tablesReady": true, ... }

# Schema-only (creates warehouse + native_* tables; no seed):
# curl -fsSL -X POST "$APP_URL/api/admin/tidb-migrate" \
#   -H "Authorization: Bearer $CRON_SECRET" -H "Content-Type: application/json" \
#   -d '{"action":"schema"}' 

# Public CDN export (no auth)
curl -fsSL "$APP_URL/api/data/players-export" | head -c 200
# expect: {"ok":true,"v":7,...}
```

Or re-run the GitHub Action with action = `status`.

No extra redeploy is required after a successful migrate unless you just changed env vars.

## After it works
- Leave `WAREHOUSE_DUAL_WRITE_SUPABASE` unset (TiDB-only writes).
- Leave `WAREHOUSE_UPLOAD_BRAIN` unset (stop publishing `master_player_brain.json`).
- After a day of healthy `/api/data/players-export`, you can stop relying on the Supabase Storage brain.

## Rollback
- Remove or blank `DATABASE_URL` on Vercel and redeploy — clients fall back to Supabase brain / local Sleeper catalog.
- Set `WAREHOUSE_UPLOAD_BRAIN=1` and `WAREHOUSE_DUAL_WRITE_SUPABASE=1` if you need the legacy path again.
