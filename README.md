# Campus Gaming Network

Central hub for collegiate gamers: discover schools, events, teams, and campus gaming activity.

The product/domain docs live in [`docs/`](./docs/README.md). This root README
covers the local scaffold and current implementation status.
This file also works well for lightweight integration smoke-test changes.

## Current status

The feature slices through events, teams, dashboard, and basic
safety intake are implemented locally:

- `apps/web` — TanStack Start main site with public pages, auth forms, profiles, schools, events, teams, dashboard, support, and report UI, plus route metadata and pending, error, and not-found boundaries
- `apps/api` — Go API with health, auth/session middleware, schools/games, events, teams, dashboard helpers, support tickets, and reports
- `apps/docs` — VitePress viewer for the Markdown product and engineering documentation
- `db/migrations` — versioned SQL migrations
- `docker-compose.yml` — web + API + Postgres
- `.github/workflows/ci.yml` — initial CI checks

Implemented locally: identity/profile, 18+ and home-school signup enforcement,
email verification, password reset, all 6,243 seeded schools, six launch games,
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
npm install
npm run dev:docs
```

Then open http://localhost:3001. The command renders the current Markdown and
serves it on localhost only with live reload. Use `npm run build:docs` to verify
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

The first run downloads Node and Go dependencies in Docker. The `migrate`
service applies pending files from `db/migrations` before the API starts, even
when the Postgres volume already exists.

## Local commands

When adding or updating npm packages, pin exact versions in `package.json` so installs do not silently drift.

```bash
npm run dev:web
npm run check:apps-compose
npm run lint:web
npm run typecheck:web
npm run test:web
npm run test:e2e:web
npm run fmt:check:api
npm run vet:api
npm run test:api
```

Every frontend and backend change should include or update regression tests.
Run the relevant test suite, typecheck, and lint checks before considering the
change complete; see the testing expectation in docs/11-implementation-decisions.md.
Go style expectations are documented in [`docs/go-style.md`](./docs/go-style.md).

The web commands require installing the workspace dependencies and Playwright
browser first:

```bash
nvm use
npm ci
npx playwright install chromium
```

The browser suite starts an isolated API fixture and the built Nitro production
server, then runs the primary journeys in desktop, mobile, and JavaScript-disabled
Chromium. Use `npm run test:e2e:web:dev` to run the same suite
against the Vite development server. Neither variant requires Docker or a
populated development database.

The API needs Go 1.27.1 or newer (set by the `go` directive in `apps/api/go.mod`).
CI and the API Docker build use Go 1.27.1. With Go 1.21 or newer and the default
`GOTOOLCHAIN=auto`, commands inside `apps/api` select and download the required
toolchain automatically. The npm formatting scripts use that toolchain's `gofmt`.
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
  api/      Go API
  docs/     Local documentation viewer
  web/      TanStack Start main site and BFF
data/       School seed data
db/         SQL migrations and database notes
docs/       Product, architecture, API, and roadmap docs
scripts/    Utility scripts
```

## Phase 0 exit criteria

- `docker compose up --build` starts web, API, and Postgres.
- `GET /health` returns API liveness.
- `GET /ready` confirms the API can reach Postgres.
- The web shell renders and exposes a BFF health route at `/api/health`.
