# Outbound API inventory (Phase 1 freeze)

Captured for the Edge + TiDB overhaul. Request-path sinks must move to TiDB/CDN or client.

## Server-side Sleeper
- `src/lib/league.server.ts` — leagues, rosters, matchups, transactions, projections
- `src/lib/players.server.ts` — catalog, bio, game logs, news helpers, injuries
- `src/lib/players-build.ts` — projections / season stats / schedule
- `src/lib/scoring.server.ts`, `league-settings.server.ts`, `standings-projections.server.ts`
- `src/lib/aggregation.server.ts` — warehouse identity ingest
- `src/lib/trade-market.server.ts`, `are-they-playing.server.ts`
- `scripts/projection-engine/*`

## Server-side ESPN
- `src/lib/league.server.ts` — lm-api-reads.fantasy.espn.com + athlete meta
- `src/lib/players.server.ts` — news / injury feeds
- `src/lib/are-they-playing.server.ts`
- `src/routes/api/public/scoreboard.ts` — CDN-cached proxy (keep pattern)

## nflverse / club scrapes (cold bombs)
- `src/lib/redzone.server.ts`, `targets.server.ts`, `matchup-replay.server.ts` — PBP `.csv.gz`
- `src/lib/nfl-roster-status.server.ts` — roster/injury CSV
- `src/lib/are-they-playing.server.ts` — 32 NFL club HTML pages

## Client-direct (intentional)
- `useSleeperPlayers`, `useLeagueProjections`, `useWeeklyActualStats`, home ESPN news
- Live score ticker via `/api/public/scoreboard`

## Supabase B / brain
- `aggregation.server.ts` → `player_warehouse` + `master_player_brain.json` (migrate to TiDB)
- `playerBrainHydration.ts` — client brain download (retire after seed)

## Crons
- `api/cron/warehouse-ingest`, `api/cron/league-delta-sync`
- `.github/workflows/league-delta-sync.yml`, `projection-engine.yml`
