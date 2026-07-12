# 13 — Deployment plan

Main-site MVP deployment target and launch checklist.

## Decision

Deploy the main-site MVP on **Railway**:

- Railway hosts the Next.js web service.
- Railway hosts the Go API service.
- Railway hosts production PostgreSQL.
- Cloudflare remains the DNS/protection layer for `campusgamingnetwork.com`.
- Resend remains the transactional email provider.
- Sentry/error monitoring is post-MVP.

This replaces the earlier open-ended “deploy path” question. Supabase is no longer the assumed production database for the MVP unless we later decide to migrate.

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
        ▼
Railway private networking
        │
        ▼
Railway private API service
Go REST/JSON API
        │
        ▼
Railway PostgreSQL
```

Only the Next.js web service should be publicly exposed for the main MVP. The Go API should be reachable by the web service over Railway private networking. If a public API URL is temporarily needed for debugging, it should be treated as temporary and removed before public launch.

## Services

| Railway service | Public? | Purpose |
|-----------------|---------|---------|
| `web` | Yes | Next.js main site at `campusgamingnetwork.com` |
| `api` | Prefer no | Go API used by the Next.js BFF/server actions |
| `postgres` | No | Production database |
| `migrate` or pre-deploy command | No | Applies SQL migrations before the API serves traffic |

## Environments

Use at least:

- `production` — `campusgamingnetwork.com`, production Postgres, real email.
- `staging` — optional but preferred before launch; Railway-generated domain or `staging.campusgamingnetwork.com`, separate Postgres, email either sandboxed or clearly marked.

Local development remains Docker Compose with local Postgres.

## Domain and DNS

Production domain target:

- Primary: `campusgamingnetwork.com`
- Optional redirect/alias: `www.campusgamingnetwork.com`

Cloudflare should manage DNS. Railway custom-domain records should be added in Cloudflare for the public Next.js service. Keep proxy/protection enabled unless Railway domain validation requires a temporary DNS-only setup.

## Environment variables

Production values should be set in Railway service variables, not committed to the repo.

### Web service

| Variable | Notes |
|----------|-------|
| `API_INTERNAL_URL` | Internal Railway URL for the `api` service, ideally private-network URL |
| `API_SESSION_COOKIE` | `cgn_session` unless changed |
| `NODE_ENV` | `production` |

### API service and migration runner

| Variable | Notes |
|----------|-------|
| `API_DATABASE_URL` | Railway Postgres connection string |
| `API_SITE_URL` | `https://campusgamingnetwork.com` |
| `API_SESSION_COOKIE` | `cgn_session` |
| `API_COOKIE_SECURE` | `true` |
| `API_RESEND_API_KEY` | Production Resend key |
| `API_ACCOUNT_EMAIL_FROM` | `account@campusgamingnetwork.com` |
| `API_EVENTS_EMAIL_FROM` | `events@campusgamingnetwork.com` |
| `API_NOTIFICATIONS_EMAIL_FROM` | `notifications@campusgamingnetwork.com` |
| `API_SUPPORT_EMAIL_FROM` | `support@campusgamingnetwork.com` |

## Migrations and seed data

Use the existing Go migrator against Railway Postgres:

```bash
cd apps/api
go run ./cmd/migrate -dir ../../db/migrations
```

For Railway, prefer a dedicated migration service/job or API pre-deploy command that runs before the API starts serving the new version.

Production launch data:

- Apply every `db/migrations/*.up.sql` file.
- Run the school seed once with all 6,243 active schools.
- Seed the six MVP games.
- Do not seed the local development test user in production.

## Backups and restore

Before public launch:

- Enable/verify Railway Postgres backups.
- Document the restore process in ops notes.
- Perform at least one restore drill against staging or a disposable Railway environment.

Point-in-time recovery is not required for MVP, but can be revisited after launch.

## Launch smoke test

After deploying to Railway and pointing DNS:

1. `GET /health` on the API returns healthy from inside Railway.
2. `GET /ready` confirms API → Railway Postgres connectivity.
3. `https://campusgamingnetwork.com` loads.
4. Signup creates an account, requires 18+ and home school, and sends verification email.
5. Login/logout works with secure cookies.
6. School search and follow/unfollow work.
7. Event create → RSVP yes → confirmation email with calendar file works.
8. Team create → join by password works.
9. Dashboard shows upcoming RSVPs, followed-school events, and team activity.
10. Support ticket submission works logged out.
11. Event/user reports work logged in.
12. Private event unlock does not leak private details pre-unlock.

## Rollback posture

For MVP:

- App rollback: redeploy the previous Railway deployment.
- Database rollback: restore from Railway backup if a bad migration/data issue requires it.
- Migration rule: never edit production schema manually; apply changes through migration files.

## Open deployment choices

- Whether to create a separate staging Railway environment before first public launch.
- Whether `www.campusgamingnetwork.com` redirects to apex or also serves the app directly.
- Whether migrations run as a dedicated service/job or as API pre-deploy.
- Exact Railway service names and environment names.

## References

- [Railway Next.js guide](https://docs.railway.com/guides/nextjs)
- [Railway PostgreSQL](https://docs.railway.com/databases/postgresql)
- [Railway private networking](https://docs.railway.com/networking/private-networking)
- [Railway public networking](https://docs.railway.com/networking/public-networking)
