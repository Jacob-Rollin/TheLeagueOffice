#!/usr/bin/env bash
# Step 3–4 helper: migrate TiDB warehouse then verify players-export.
# Usage:
#   export CRON_SECRET="from-vercel"
#   ./scripts/tidb/run-migrate.sh
# Optional:
#   APP_URL=https://theleagueoffice.app ACTION=status ./scripts/tidb/run-migrate.sh
set -euo pipefail

APP_URL="${APP_URL:-https://theleagueoffice.app}"
ACTION="${ACTION:-migrate}"
BASE="${APP_URL%/}"

if [ -z "${CRON_SECRET:-}" ]; then
  echo "Set CRON_SECRET to the same value as Vercel → Environment Variables → CRON_SECRET"
  exit 1
fi

if [ "$ACTION" = "status" ]; then
  echo "→ GET $BASE/api/admin/tidb-migrate"
  curl -fsS -H "Authorization: Bearer $CRON_SECRET" "$BASE/api/admin/tidb-migrate"
  echo
else
  echo "→ POST $BASE/api/admin/tidb-migrate action=$ACTION"
  curl -fsS -X POST "$BASE/api/admin/tidb-migrate" \
    -H "Authorization: Bearer $CRON_SECRET" \
    -H "Content-Type: application/json" \
    -d "{\"action\":\"$ACTION\"}"
  echo
fi

echo "→ GET $BASE/api/data/players-export"
EXPORT="$(curl -fsS "$BASE/api/data/players-export")"
echo "$EXPORT" | head -c 240
echo
echo "$EXPORT" | grep -q '"ok":true' || {
  echo "FAIL: players-export not ok yet (merge cutover PR + re-run migrate if 404/empty)"
  exit 1
}
echo "OK: players-export healthy"
