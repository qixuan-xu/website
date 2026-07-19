# Qixuan admin Worker

Cloudflare Worker backend for the private admin application. The public website can remain on GitHub Pages; this Worker owns authenticated content changes and exposes only the published snapshot at `GET /v1/content`.

## Security model

- Production authentication is Cloudflare Access only. The Worker verifies the `Cf-Access-Jwt-Assertion` signature, issuer, audience, expiry, and exact administrator email.
- The local bearer-token bypass runs only when `ENVIRONMENT=development`. Production ignores `DEV_BEARER_TOKEN`.
- Access JWT material is never returned to browser JavaScript. The session endpoint derives a CSRF token from the current assertion.
- Every mutation requires an exact `Origin`, `X-CSRF-Token`, and `application/json` body.
- Admin responses are `no-store`; all responses receive CSP, frame, MIME-sniffing, referrer, and permissions headers.
- Drafts and published snapshots are immutable D1 versions with optimistic revision checks. Rollback creates a new draft; it does not silently change the public version.
- Runtime validation enforces the site schema, unique project IDs and slugs, the public client's email contract, and credential-free HTTPS URLs no longer than 2,048 characters.
- The Worker contains no credentials. Do not commit `.dev.vars` or any production value.

Protect the custom admin hostname with a Cloudflare Access self-hosted application and disable the public `workers.dev` route. The Access policy and the Worker's `ADMIN_EMAIL` check should both allow only the intended administrator.

## API

Public:

- `GET /v1/health`
- `GET /v1/content` → `{ data: <site content>, meta: { revision, versionId, publishedAt } }`

Admin:

- `GET /v1/admin/session`
- `POST /v1/admin/logout`
- `GET /v1/admin/content`
- `PUT /v1/admin/content` (`If-Match: "draft-N"` or `expectedRevision`)
- `PUT /v1/admin/draft` compatibility alias
- `POST /v1/admin/publish`
- `GET /v1/admin/versions?limit=25&cursor=N`
- `POST /v1/admin/rollback`

Admin success responses use `{ ok: true, data, requestId }`. Errors use `{ ok: false, error: { code, message, requestId, details? } }`.

Example mutation body and headers:

```http
PUT /v1/admin/content
Content-Type: application/json
If-Match: "draft-4"
X-CSRF-Token: <value returned by /v1/admin/session>

{"content": {"schemaVersion": 1, "...": "..."}}
```

## Local development

```sh
cp .dev.vars.example .dev.vars
npm install
npx wrangler d1 migrations apply qixuan-admin --local
npm run dev
```

Replace the example development token with a long random value. Send it only to local admin requests as `Authorization: Bearer <token>`.

## Production setup

1. Create a D1 database and replace the all-zero `database_id` in `wrangler.jsonc`.
2. Apply `migrations/0001_content.sql` with Wrangler.
3. Configure `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, and `ADMIN_EMAIL` as encrypted Worker secrets. Wrangler preserves encrypted secrets across subsequent deploys; do not duplicate them under plaintext `vars`:

   ```sh
   npx wrangler secret put ACCESS_TEAM_DOMAIN
   npx wrangler secret put ACCESS_AUD
   npx wrangler secret put ADMIN_EMAIL
   ```

   `wrangler secret put` requires the Worker to exist. On the first deployment, supply all three values with `wrangler deploy --secrets-file .prod.secrets`; `.prod.secrets` is gitignored and must be stored locally and securely deleted after use. Never place secret values in `wrangler.jsonc`, command history, source files, or GitHub Pages assets. Production authentication fails closed with a configuration error if any of these bindings is absent.
4. Configure the Cloudflare Access application for `admin.qixuan.net` before exposing the hostname.
5. Point the `ASSETS` directory at the built admin SPA if its output path differs from `../admin`.
6. Run `npm run check`, then deploy.

D1 is seeded lazily from `../content/site.json` after the migration creates an empty schema. Content is validated at runtime against `../content/site.schema.json`; the migration does not duplicate the content document.
