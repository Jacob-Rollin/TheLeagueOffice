# TiDB warehouse cutover

## Prerequisites
- TiDB Serverless cluster `league-office-native`
- `DATABASE_URL` on Vercel (Production + Preview) and locally/Cloud Agent
- `CRON_SECRET` for admin routes
- Existing Supabase brain or `player_warehouse` rows to seed from

## Steps
1. Deploy this branch (or merge) so `/api/admin/tidb-migrate` exists.
2. Run migrate:
   ```sh
   curl -X POST "$APP_URL/api/admin/tidb-migrate" \
     -H "Authorization: Bearer $CRON_SECRET" \
     -H "Content-Type: application/json" \
     -d '{"action":"migrate"}'
   ```
3. Verify:
   ```sh
   curl -sH "Authorization: Bearer $CRON_SECRET" "$APP_URL/api/admin/tidb-migrate"
   # expect playerWarehouseCount >= ~4000
   curl -s "$APP_URL/api/data/players-export" | head -c 200
   # expect {"ok":true,"v":7,...}
   ```
4. Leave `WAREHOUSE_DUAL_WRITE_SUPABASE` unset (TiDB-only writes).
5. Leave `WAREHOUSE_UPLOAD_BRAIN` unset (stop publishing master_player_brain.json).
6. After a day of healthy `/api/data/players-export`, you can stop relying on Supabase Storage brain.

## Rollback
- Remove or blank `DATABASE_URL` on Vercel and redeploy — clients fall back to Supabase brain / local Sleeper catalog.
- Set `WAREHOUSE_UPLOAD_BRAIN=1` and `WAREHOUSE_DUAL_WRITE_SUPABASE=1` if you need to rebuild the legacy path.
