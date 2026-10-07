# Cloudflare R2 setup (research / snap CDN)

Browse can read public research JSON from R2 (free egress) instead of TiDB via Vercel.
GitHub Actions uploads after the morning research warm.

## 1. Cloudflare

1. Sign in at [dash.cloudflare.com](https://dash.cloudflare.com).
2. **R2 Object Storage** → **Create bucket** → name `tlo-snaps`.
3. Open the bucket → **Settings**:
   - **Public access** → **Allow Access** (gives a `https://pub-….r2.dev` URL), **or**
   - **Connect Domain** → `cdn.theleagueoffice.app` (preferred).
4. R2 overview → **Manage R2 API Tokens** → **Create API token**:
   - Permissions: **Object Read & Write**
   - Bucket: `tlo-snaps`
5. Copy **Account ID**, **Access Key ID**, **Secret Access Key**.

## 2. GitHub Actions secrets

Repo → **Settings** → **Secrets and variables** → **Actions** → add:

| Secret | Value |
|---|---|
| `R2_ACCOUNT_ID` | Cloudflare account id |
| `R2_ACCESS_KEY_ID` | R2 token access key |
| `R2_SECRET_ACCESS_KEY` | R2 token secret |
| `R2_BUCKET` | `tlo-snaps` |
| `R2_PUBLIC_BASE` | `https://cdn.theleagueoffice.app` or `https://pub-….r2.dev` (no trailing slash) |

`APP_URL` + `CRON_SECRET` must already exist (same as other warm workflows).

## 3. Vercel build env (so the browser knows the public URL)

Project → **Settings** → **Environment Variables** (Production):

| Name | Value |
|---|---|
| `VITE_R2_PUBLIC_BASE` | same as `R2_PUBLIC_BASE` |

Redeploy after setting it (Vite bakes this at build time).

## 4. First publish

Actions → **Publish R2 Research Snaps** → **Run workflow**.

Then open:

`{R2_PUBLIC_BASE}/research/fpa-half.json`

You should see JSON. Site research pages will prefer that URL over `/api/data/research/*`.

## Cadence

- Daily **08:45 UTC** (after research warm)
- Gameday evenings **19:45 UTC** (Sun/Mon/Thu)
- Manual `workflow_dispatch` anytime
