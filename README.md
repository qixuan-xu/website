# qixuan.net

Qixuan Xu's public portfolio and private content control panel.

## Architecture

| Surface | Hosting | Purpose |
| --- | --- | --- |
| `qixuan.net` | GitHub Pages | Public portfolio with a built-in content fallback |
| `admin.qixuan.net` | Cloudflare Worker static assets | Private editor protected by Cloudflare Access |
| `api.qixuan.net` | Cloudflare Worker | Public published content API |
| Cloudflare D1 | Cloudflare | Drafts, immutable versions, publish state, and audit records |

The public homepage requests `GET https://api.qixuan.net/v1/content`. If the API is slow, unavailable, or returns invalid data, the checked-in HTML remains visible instead of rendering an empty page.

Because the public site stays on GitHub Pages, admin changes to title/description update JavaScript-capable browsers but do not rewrite the checked-in HTML used by every social preview crawler. Change fallback/OG metadata in `index.html` when crawler-visible metadata must change too.

The admin application never implements its own password form and never stores an authentication token. Cloudflare Access authenticates the user, while the Worker verifies the Access JWT again before every admin request. Writes also require an exact origin, a CSRF token, schema-valid JSON, and the current draft revision.

## Repository layout

- `index.html` — public homepage and safe API hydration
- `content/site.json` — initial site content and local fallback source
- `content/site.schema.json` — strict content contract
- `admin/` — responsive admin application
- `worker/` — Worker API, D1 migration, security checks, and tests
- `home/` — older personal dashboard experiment; separate from the admin application

`_config.yml` excludes `admin/`, `worker/`, and the source content model from the GitHub Pages artifact. The admin assets are published only through the Access-protected Worker hostname.

## Local verification

```sh
cd worker
npm install
npx wrangler d1 migrations apply qixuan-admin --local
npm run check
npx wrangler deploy --dry-run
```

For the admin UI demo, start the Worker locally and open `http://localhost:8787/?demo=1`. Demo mode is accepted only on `localhost` or `127.0.0.1` and does not enable production authentication bypasses.

Production setup, required secrets, API routes, and the Cloudflare Access checklist are documented in [`worker/README.md`](worker/README.md).
