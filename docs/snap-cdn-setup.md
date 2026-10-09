# Snap CDN setup (GitHub branch — no credit card)

Browse reads public research/snap JSON from the orphan `snap-cdn` branch
instead of TiDB via Vercel. No Cloudflare R2 / card required.

## What you do (one-time)

### 1. Vercel build env

Project → **Settings** → **Environment Variables** → **Production**:

| Name | Value |
|---|---|
| `VITE_SNAP_CDN_BASE` | `https://raw.githubusercontent.com/Jacob-Rollin/TheLeagueOffice/snap-cdn` |

No trailing slash. Then redeploy a **`main`** deployment (Vite bakes this at build time).

**Do not** promote / redeploy a deployment from branch `snap-cdn` — that branch is JSON-only and will 404 the whole site. `vercel.json` disables automatic Vercel deploys for `snap-cdn` and agent `cursor/*` branches (Hobby ~100 deploys/day). Production still auto-deploys from `main`.

(`APP_URL` + `CRON_SECRET` must already exist as GitHub Actions secrets — same as other warm workflows.)

### 2. First publish

After this PR is on `main` (or from the PR branch):

1. Actions → **Publish Snap CDN** → **Run workflow**
2. Confirm branch `snap-cdn` appears on the repo
3. Open:

`https://raw.githubusercontent.com/Jacob-Rollin/TheLeagueOffice/snap-cdn/research/fpa-half.json`

You should see JSON. Research pages then prefer that URL over `/api/data/research/*`.

## Optional: GitHub Pages

If you want a slightly nicer host later: **Settings** → **Pages** → Deploy from
branch `snap-cdn` / `/ (root)`. Then set `VITE_SNAP_CDN_BASE` to the Pages URL
(e.g. `https://jacob-rollin.github.io/TheLeagueOffice`). Not required for the
raw.githubusercontent.com path.

## Cadence

- Daily **08:45 UTC** (after research warm)
- Gameday evenings **19:45 UTC** (Sun/Mon/Thu)
- Manual `workflow_dispatch` anytime
- **Native live week stats** (separate workflow `native-live-week-stats.yml`): every 5 minutes on gameday UTC windows; writes `snap/native-week-stats-{season}-w{week}.json` only (preserves research files)

Each run **force-pushes an orphan** `snap-cdn` branch (no git history bloat).

## Limits (approx.)

| Resource | Our usage | Notes |
|---|---|---|
| Actions minutes | Free (public repo) | Standard runners |
| Repo size | ~5–50 MB on `snap-cdn` only | Main branch untouched |
| raw.githubusercontent.com | Fine for ~20 users | Soft rate limits; not a global CDN |

If traffic grows a lot later, move the same object keys to Cloudflare R2 and
point `VITE_SNAP_CDN_BASE` (or `VITE_R2_PUBLIC_BASE`) at the R2 public URL.
