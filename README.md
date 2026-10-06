# The League Office

A fantasy football headquarters for drafting, managing, and researching your leagues. Sync your Sleeper, ESPN, or Yahoo leagues, or run a league natively, and get draft tools, trade and waiver analysis, weekly research, and league history in one place. Half-PPR is the default scoring format.

## Features

- **Draft**: War Room for live drafts and a Mock Draft Simulator with configurable teams, rounds, and roster positions.
- **Playbook**: League dashboard with My Team, Matchup, Standings, Rosters, Transactions, Power Rankings, and the Press Room.
- **Trade**: Trade Desk analyzer and Trade Market Values, using player Value/Trend metrics.
- **Waivers**: The Wire and Top Available, with add/drop suggestions that respect roster requirements.
- **Research**: Injury Reports, Are They Playing?, Matchups Guide, Strength of Schedule analysis, weekly and season projections, Fantasy Leaders, Fantasy Points Allowed, Most Targeted Players, and Red Zone Stats.
- **League Sync**: Connect Sleeper, ESPN, and Yahoo leagues from the account menu.
- **Hall of Fame**: Championship history and single-week and season records.
- **Mobile**: A dedicated mobile experience under `/m`.
- **Live ticker**: NFL scores running across the top of every page.

## Tech stack

- [TanStack Start](https://tanstack.com/start) (React 19, TanStack Router, TanStack Query) with server-side rendering
- Vite, Tailwind CSS v4, and Radix UI components
- [Supabase](https://supabase.com) for auth and native league ops:
  - **Database A**: users, profiles, leagues, rosters, lineups, transactions, articles, and Hall of Fame records
- [TiDB Cloud Serverless](https://www.pingcap.com/tidb-cloud/) (`DATABASE_URL`) for `player_warehouse`, synced league snapshots, and research aggregates (CDN-cached `/api/data/*` routes)
- Deployed on [Vercel](https://vercel.com) with GitHub Actions for tiered background sync (Cloudflare Workers abandoned)

## Getting started

You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd TheLeagueOffice
npm i
npm run dev
```

### Environment variables

Create a `.env` file in the project root:

```sh
# Database A (primary)
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=

# Database B (player warehouse)
VITE_SUPABASE_URL_B=
VITE_SUPABASE_ANON_KEY_B=

# Server-only
SUPABASE_URL=
SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# TiDB Serverless (player warehouse + synced snapshots)
DATABASE_URL=mysql://USER:PASS@GATEWAY/league-office-native

# Cron / webhook auth
CRON_SECRET=

# Yahoo league sync
YAHOO_CLIENT_ID=
YAHOO_CLIENT_SECRET=
```

Set the same variables in your Vercel project settings for deployments.

### TiDB warehouse cutover (one-time)

1. Create a TiDB Serverless cluster and set `DATABASE_URL` on **Vercel** (Production + Preview) and in this Cloud Agent environment.
2. Apply schema + seed from the Supabase brain in one call:
   ```sh
   curl -X POST "$APP_URL/api/admin/tidb-migrate" \
     -H "Authorization: Bearer $CRON_SECRET" \
     -H "Content-Type: application/json" \
     -d '{"action":"migrate"}'
   ```
   Or separately: `{"action":"schema"}` then `{"action":"seed"}`.
3. Confirm: `GET /api/admin/tidb-migrate` (same auth) reports `playerWarehouseCount` ≈ 4000+.
4. Redeploy Vercel. Clients hydrate from `/api/data/players-export` (CDN-cached); Supabase brain is legacy fallback only.
5. Optional env flags:
   - `WAREHOUSE_DUAL_WRITE_SUPABASE=1` — keep writing Supabase B during transition
   - `WAREHOUSE_UPLOAD_BRAIN=1` — keep publishing `master_player_brain.json`
6. Background sync uses `/api/webhooks/sync` and `/api/cron/*` — never wire host events to `repository_dispatch`.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run build` | Production build |
| `npm run preview` | Preview the production build |
| `npm run lint` | Run ESLint |
| `npm run format` | Format with Prettier |

## Database

Supabase migrations live in `supabase/migrations`. Admin access is granted through `profiles.role = 'admin'`.
