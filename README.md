# Campus Gaming Network

Central hub for collegiate gamers: discover schools, events, teams, and campus gaming activity.

The product/domain docs live in [`docs/`](./docs/README.md). This root README
covers the local scaffold and current implementation status.

## Current status

The feature slices through events, teams, dashboard, and basic
safety intake are implemented locally:

- `apps/web` — TanStack Start main site with public pages, auth forms, profiles, schools, events, teams, dashboard, support, and report UI, plus route metadata and pending, error, and not-found boundaries
- `apps/api` — Go API with health, auth/session middleware, schools/games, events, teams, dashboard helpers, support tickets, reports, and the Admin Console API
- `apps/admin` — TanStack Start Admin Console (in progress and release-gated; see [`docs/20-admin-console-v1-engineering-plan.md`](./docs/20-admin-console-v1-engineering-plan.md))
- `apps/docs` — VitePress viewer for the Markdown product and engineering documentation
- `db/migrations` — versioned SQL migrations
- `docker-compose.yml` — web + API + Postgres
- `.github/workflows/ci.yml` — Go format, vet, and PostgreSQL-backed tests; workspace format, audit, typecheck, lint, unit, build, and browser tests

Implemented locally: identity/profile, 18+ and home-school signup enforcement,
email verification, password reset, all 6,243 seeded schools, a game catalog imported from IGDB,
school follow/unfollow, events with RSVP/interested/private unlock/default
banners, teams with password join/captains/ownership transfer, dashboard
sections, support tickets, and event/user reports.

Remaining launch work is the external launch rehearsal and production rollout
tracked in [`docs/10-delivery-status.md`](./docs/10-delivery-status.md). Railway build,
pre-deploy migration, health-check, one-time seed, and smoke-test configuration
now lives in [`railway/`](./railway) and is documented in
[`docs/13-deployment-plan.md`](./docs/13-deployment-plan.md).

## Quick start

```bash
docker compose up --build
```

Then open:

- Web: http://localhost:3000
- API health: http://localhost:8080/health
- API readiness: http://localhost:8080/ready

### Local documentation

The Markdown files in `docs/` are also available through a local documentation
viewer with navigation, tables of contents, code highlighting, dark mode, and
rendered Mermaid diagrams:

```bash
nvm use
pnpm install --frozen-lockfile
pnpm run dev:docs
```

Then open http://localhost:3001. The command renders the current Markdown and
serves it on localhost only with live reload. Use `pnpm run build:docs` to verify
the production documentation bundle.

To run the viewer through Docker Desktop instead, create its optional Compose
service once from Terminal while Docker Desktop is running:

```bash
docker compose up --build -d docs
```

Then open http://localhost:3001. The service appears under the `core` Compose
application in Docker Desktop, where it can be stopped and started with the
standard controls. Local changes in `docs/` and `apps/docs/.vitepress/` reload
automatically. Because the service uses the `docs` profile, it is not started by
the repository's normal `docker compose up` command unless it is targeted
explicitly.

Local Docker Compose also seeds a verified development user:

- Email: `dev@campusgamingnetwork.test`
- Password: `Password12345!`

### Local Admin Console

Start the Admin Console with its local-only signed Access identity and
site-administrator grant:

```bash
pnpm run compose:up:admin
```

Then open http://localhost:3002. The console identifies the browser as the
seeded `dev@campusgamingnetwork.test` administrator; no Cloudflare account or
password is required. The command generates an ephemeral signing key inside
the Admin container, exposes only its public key to the normal Access
validators, and bootstraps the local grant through `cgn-admin`. JWT, session,
CSRF, and capability checks remain active.

The local identity is accepted only with `DEPLOYMENT_ENV=local`, a loopback
Admin URL, an explicit `.test` email, and the local JWKS endpoint. The Admin
port is published to `127.0.0.1` only. After the first run, the `admin` and
`object-storage` services appear under the `core` application in Docker
Desktop and can use its normal stop/start controls.

### Demo data

To browse a realistic, well-populated local site, start the stack with the
`demo` profile:

```bash
pnpm run compose:up:demo
```

It adds about 3,000 users, 6,000 event rows (including recurring series),
150,000 RSVPs, 1,200 teams, reports, support tickets, and notifications across
every visibility, format, capacity, and verification state. Every demo account
uses the password `Password12345!` and an email at `@demo.campusgamingnetwork.test`.
Useful logins: `player@`, `organizer@`, `schooladmin@`, `faculty@`, `suspended@`,
`newcomer@` (no activity), `unverified@`, and `moderator@`.

Reseed a running stack with `pnpm run seed:demo`, or delete the demo rows and
generate them again with `pnpm run seed:demo:reset`. Seeding is deterministic
and idempotent, refuses to run unless `DEPLOYMENT_ENV=local`, and never touches
rows outside the demo email domain. Size it with the `-demo-users`,
`-demo-events`, `-demo-teams`, and `-demo-seed` flags of `cgn-seed`.

The first run downloads Node and Go dependencies in Docker. The `migrate`
service applies pending files from `db/migrations` before the API starts, even
when the Postgres volume already exists.

## Local commands

Use Node.js 24 and the pnpm version pinned in `package.json`. When adding or
updating packages, pin exact versions so installs do not silently drift.

```bash
pnpm run dev:web
pnpm run dev:admin
pnpm run check:apps-compose
pnpm run lint:web
pnpm run typecheck:web
pnpm run test:web
pnpm run test:e2e:web
pnpm run test:e2e:real
pnpm run typecheck:admin
pnpm run lint:admin
pnpm run test:admin
pnpm run test:e2e:admin
pnpm run fmt:check:api
pnpm run vet:api
pnpm run test:api
```

Every frontend and backend change should include or update regression tests.
Run the relevant test suite, typecheck, and lint checks before considering the
change complete; see the testing expectation in docs/11-implementation-decisions.md.
Go style expectations are documented in [`docs/go-style.md`](./docs/go-style.md).

The web commands require installing the workspace dependencies and Playwright
browser first:

```bash
nvm use
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
```

The fast browser suite starts an isolated API fixture and the built Nitro production
server, then runs the primary journeys in desktop, mobile, and JavaScript-disabled
Chromium. Use `pnpm run test:e2e:web:dev` to run the same suite
against the Vite development server. Neither variant requires Docker or a
populated development database.

`pnpm run test:e2e:real` runs a focused launch-proof suite through the built Nitro
BFF, real Go API, PostgreSQL, and an in-process Resend HTTP stub. By default it
starts a dedicated `cgn_e2e` PostgreSQL container on port `55432`, applies all
migrations, resets and seeds a small deterministic fixture, and always removes
the container and its volume afterward, including after failures. The seed
command refuses to reset a database whose name does not contain `e2e`. Set
`REAL_E2E_DATABASE_URL` to use an already-provisioned disposable test database;
in that mode the command does not manage that database's lifecycle.

`pnpm run test:e2e:admin:real` runs the Admin Console's real-stack journeys
through the built Admin BFF, the real Go API with `ADMIN_ENABLED`, and
PostgreSQL. A local stub publishes the Cloudflare Access signing key and the
suite signs its own assertions with it; a second stub stands in for the R2
bucket. The runner provisions and removes the database like the command above,
seeds the operators and records the suite drives, and bootstraps the first site
admin through `cgn-admin`. `REAL_E2E_DATABASE_URL` works the same way.

The API needs the Go version set by the `go` directive in `apps/api/go.mod`; CI
reads that file, and the API Dockerfile's builder image matches it. With Go 1.21
or newer and the default
`GOTOOLCHAIN=auto`, commands inside `apps/api` select and download the required
toolchain automatically. The pnpm formatting scripts use that toolchain's `gofmt`.
Go module commands also download the PostgreSQL driver dependency as needed:

```bash
cd apps/api
go test ./...
go run ./cmd/api
```

To apply migrations directly against a local Postgres instance:

```bash
cd apps/api
go run ./cmd/migrate -dir ../../db/migrations
```

## Environment

Copy `.env.example` if you want Docker Compose overrides:

```bash
cp .env.example .env
```

Docker Compose provides sensible local defaults.

## Repo layout

```text
apps/
  admin/    TanStack Start Admin Console and admin BFF
  api/      Go API
  docs/     Local documentation viewer
  web/      TanStack Start main site and BFF
data/       School seed data
db/         SQL migrations and database notes
docs/       Product, architecture, API, and roadmap docs
scripts/    Utility scripts
```
