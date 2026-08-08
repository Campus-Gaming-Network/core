# 13 — Deployment plan (Railway)

Concrete deployment configuration and launch checklist for the first release. The repository-side work is encoded under `railway/`; provisioning services, secrets, backups, DNS, and running the production smoke test remain operator actions.

## Locked production decisions

| Area | Decision |
|------|----------|
| Project services | `web`, `api`, and `postgres`; `seed` exists only for the one-time catalog bootstrap |
| Environments | Use `staging` for the launch rehearsal, then `production`; keep their databases and secrets separate |
| Public access | Only `web` receives a public/custom domain; `api` and `postgres` stay private |
| Migrations | The `api` Railway pre-deploy command runs `cgn-migrate -dir /migrations` before each API deployment |
| School seed | Deploy the temporary `seed` service once per fresh environment, verify 6,243 schools, then disconnect/delete it |
| Primary domain | `campusgamingnetwork.com`; Cloudflare redirects `www.campusgamingnetwork.com` to the apex |
| Backups | Scheduled Railway volume backups plus a restore rehearsal before production launch |

## Production shape

```text
campusgamingnetwork.com
        │
        ▼
Cloudflare DNS / edge protection
        │
        ▼
Railway public web service
Next.js app / BFF / Server Actions
        │
        ▼  http over Railway private networking
Railway private API service
Go REST/JSON API
        │
        ▼
Railway PostgreSQL
```

## Repository deployment assets

| File | Purpose |
|------|---------|
| `railway/web.toml` | Web Docker build, `/api/health` deployment check, restart/drain policy |
| `railway/api.toml` | API Docker build, migration pre-deploy, `/ready` deployment check, restart/drain policy |
| `railway/seed.toml` | Temporary one-shot school-catalog bootstrap service |
| `apps/web/Dockerfile` | Node 24 production image installed with the pinned root lockfile |
| `apps/api/Dockerfile` | Go API image containing the API, migrator, seed command, migrations, and school CSV |
| `scripts/smoke_test.sh` | Automated checks for public pages and the web-to-private-API health path |

Railway config-as-code is service-specific. All source services use repository root `/` as their Railway root directory. Assign these absolute config paths in each service’s settings:

| Service | Config file path |
|---------|------------------|
| `web` | `/railway/web.toml` |
| `api` | `/railway/api.toml` |
| temporary `seed` | `/railway/seed.toml` |

## First-time Railway setup

1. Create one Railway project and add `staging` and `production` environments.
2. In `staging`, provision Railway PostgreSQL and name the service exactly `postgres`.
3. Create empty source services named exactly `api` and `web`, connect both to this repository and the intended branch, keep root directory `/`, and assign the config paths above.
4. Set the variables below. Do not generate a public domain for `api` or `postgres`.
5. Deploy `api` first. Its pre-deploy command applies every pending migration; `/ready` must reach Postgres before Railway activates the deployment.
6. Create a temporary service named `seed`, connect the same repository with `/railway/seed.toml`, set only its database variable, and deploy it once. Verify the logs report 6,243 imported rows, then disconnect or delete the service.
7. Deploy `web`, generate a Railway domain for the staging rehearsal, and complete all smoke tests.
8. Reproduce the same topology in `production`, using production-only Postgres, secrets, Resend credentials, and URLs.

## Environment variables

Values belong in Railway variables, not in the repository. Seal the Resend key after setting it. Railway injects `PORT`; both services are configured to listen on it, so do not hard-code a production port.

### `web`

| Variable | Production value |
|----------|------------------|
| `API_INTERNAL_URL` | `http://${{api.RAILWAY_PRIVATE_DOMAIN}}:${{api.PORT}}` |
| `API_SESSION_COOKIE` | `cgn_session` |
| `NODE_ENV` | `production` |
| `NEXT_TELEMETRY_DISABLED` | `1` |

The internal URL deliberately uses `http`, because Railway private-network traffic remains inside the project environment. It is available to server components/actions only and is never a browser-facing URL.

### `api`

| Variable | Production value |
|----------|------------------|
| `API_DATABASE_URL` | `${{postgres.DATABASE_URL}}` |
| `API_SITE_URL` | `https://campusgamingnetwork.com` |
| `API_SESSION_COOKIE` | `cgn_session` |
| `API_COOKIE_SECURE` | `true` |
| `API_RESEND_API_KEY` | Production Resend API key; seal this variable |
| `API_ACCOUNT_EMAIL_FROM` | `account@campusgamingnetwork.com` |
| `API_EVENTS_EMAIL_FROM` | `events@campusgamingnetwork.com` |
| `API_CATALOG_REFRESH_INTERVAL` | `24h` — how often the in-memory school catalog reloads. The catalog changes once or twice a year, so the manual refresh endpoint below is the path for a same-day change. |
| `API_MAINTENANCE_TOKEN` | Optional. Set it to enable `POST /internal/schools/refresh`, which reloads the catalog immediately after a change; seal this variable. Leave unset and the endpoint stays a 404. |

Do not set any `API_DEV_SEED_USER_*` variables outside local development. `RESEND_API_KEY` remains a temporary backwards-compatible alias in code, but `API_RESEND_API_KEY` is the canonical name.

### Temporary `seed`

| Variable | Value |
|----------|-------|
| `API_DATABASE_URL` | `${{postgres.DATABASE_URL}}` |

The seed command is intentionally not part of every deployment. It refuses a partially populated catalog, and routine catalog management moves to the later CRM.

## Migrations

`railway/api.toml` defines this API pre-deploy command:

```text
cgn-migrate -dir /migrations
```

The API image contains the migration files. Railway runs pre-deploy commands after the image build, inside the private network, with service variables available. A non-zero migration exit blocks the new API deployment. Migration files are immutable after production use: add a new numbered migration for every schema change.

## Backups and restore rehearsal

Before public launch:

1. In the `postgres` service Backups tab, enable at least daily and weekly volume backups. Monthly retention is also recommended.
2. Trigger and retain a manual backup immediately before the first production migration and before later high-risk migrations.
3. Restore a staging backup. Railway stages a replacement volume; review and deploy the staged restore, then verify migrations, the school count, signup, and event creation.
4. Record the rehearsal date and result in the launch record.

Railway’s current scheduled retention is six days for daily backups, one month for weekly backups, and three months for monthly backups. Point-in-time recovery is optional after launch, not a launch blocker.

## Domain and Cloudflare

1. After the production `web` service passes on its Railway domain, add `campusgamingnetwork.com` as its Railway custom domain.
2. Add the CNAME/flattened record Railway supplies in Cloudflare. Keep `_acme-challenge` DNS-only if certificate validation requires it.
3. Once Railway shows the certificate/domain as active, enable the normal Cloudflare proxy/protection setting.
4. Add a Cloudflare redirect rule from `www.campusgamingnetwork.com/*` to `https://campusgamingnetwork.com/$1` with a permanent redirect.
5. Confirm the API and Postgres still have no public domain or TCP proxy.

## Launch sequence

1. CI passes on the exact commit being deployed.
2. Staging API deploy applies migrations and passes `/ready`.
3. Staging seed completes once; verify 6,243 active schools and six launch games.
4. Staging web deploy passes `/api/health` and the complete manual smoke test.
5. Production Postgres backup schedules are enabled and a manual pre-launch backup exists.
6. Production API deploy applies migrations and passes `/ready`.
7. Production seed completes once and is removed/disconnected.
8. Production web deploy passes on its Railway domain.
9. Attach the apex domain, configure the `www` redirect, and run public smoke tests.
10. Watch Railway logs and metrics during the first launch window.

## Smoke tests

Run the automated public checks after the Railway domain is live and again after Cloudflare DNS is live:

```bash
./scripts/smoke_test.sh https://campusgamingnetwork.com
```

Then complete these manual checks:

1. Signup requires 18+ confirmation and a home school and sends a verification email.
2. Verification, login, logout, forgot-password, and reset-password work with secure cookies.
3. School search and follow/unfollow work.
4. Event create → RSVP yes → confirmation email with calendar file works.
5. Only organizers see event edit/delete controls; direct non-organizer edits are rejected.
6. Paid-event instructions link off-site and do not imply CGN checkout.
7. Team create → password join → captain/ownership controls work.
8. Dashboard shows upcoming RSVPs, followed-school events, and team activity.
9. Support ticket submission works logged out; event/user reports work logged in.
10. Private event responses do not expose details before unlock — check the page **head** as well as the body. A locked event must render only a generic "Private event" title with `noindex`, and its real title, description, location name, address, and password must appear nowhere in the source. The slug legitimately contains the slugified title by the documented `slugify(title)` + hash design; that is the URL itself and is not a leak.
11. Missing events, schools, teams, and profiles return **HTTP 404, not 200**. Check the status code, not just the page: a soft 404 renders the correct not-found content while still answering 200, and search engines treat that as a real page. Adding a `loading.tsx` above a `notFound()` route reintroduces this — see the constraint in [06 — Architecture](./06-architecture.md).
12. Public event and school pages carry their own title, description, and Open Graph tags; unlisted events resolve normally but are `noindex`.

## Rollback posture

- App regression: use Railway’s rollback/redeploy action for the previous successful `web` or `api` deployment.
- Failed pre-deploy migration: Railway does not activate the new API image; fix forward with a new migration or corrected unapplied migration.
- Applied bad migration/data change: stop writes if necessary and restore the verified Railway backup into the same project/environment, then redeploy the previous compatible app release.
- Never edit a migration already applied to production and never rely on manual production SQL for routine schema changes.

## Operator-only launch gates

- [ ] Railway project and `staging`/`production` environments provisioned
- [ ] `web`, `api`, and `postgres` service names/config paths verified
- [ ] Production and staging variables set; secrets separated and Resend key sealed
- [ ] Staging migration, one-time seed, and full smoke rehearsal passed
- [ ] Production daily/weekly backups enabled; restore rehearsal recorded
- [ ] Production migration and one-time seed passed
- [ ] Apex custom domain and Cloudflare `www` redirect active
- [ ] Automated and manual production smoke tests passed

## Railway references

- [Config as code](https://docs.railway.com/config-as-code)
- [Monorepo deployment](https://docs.railway.com/deployments/monorepo)
- [Pre-deploy commands](https://docs.railway.com/deployments/pre-deploy-command)
- [Private networking](https://docs.railway.com/networking/private-networking)
- [Health checks](https://docs.railway.com/deployments/healthchecks)
- [Volume backups](https://docs.railway.com/volumes/backups)
- [Working with domains](https://docs.railway.com/networking/domains/working-with-domains)
