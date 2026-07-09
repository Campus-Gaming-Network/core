# Campus Gaming Network

Central hub for collegiate gamers: discover schools, events, teams, and campus gaming activity.

The product/domain docs live in [`docs/`](./docs/README.md). This root README
covers the local scaffold and current Phase 1 progress.

## Current status

The Phase 0 foundation and the first Phase 1 backend slices are implemented:

- `apps/web` — Next.js main-site shell
- `apps/api` — Go API with health, school/game reads, and session middleware
- `db/migrations` — versioned MVP-only SQL migrations
- `docker-compose.yml` — web + API + Postgres
- `.github/workflows/ci.yml` — initial CI checks

Phase 1A and the backend portions of Phase 1B/1C are complete: migrations cover
identity/profile, schools, follows, and games; the six launch games are seeded;
all 6,243 school rows are bootstrapped; public school/game reads and
authenticated follow/unfollow routes are wired; and auth/profile APIs cover
signup, 18+ and home-school enforcement, verification, login/logout, reset,
social links, and public profiles. The main-site auth and profile UI/BFF wiring
is the next Phase 1 slice.

## Quick start

```bash
docker compose up --build
```

Then open:

- Web: http://localhost:3000
- API health: http://localhost:8080/health
- API readiness: http://localhost:8080/ready

The first run downloads Node and Go dependencies in Docker. The `migrate`
service applies pending files from `db/migrations` before the API starts, even
when the Postgres volume already exists.

## Local commands

When adding or updating npm packages, pin exact versions in `package.json` so installs do not silently drift.

```bash
npm run dev:web
npm run lint:web
npm run typecheck:web
npm run test:api
```

The web commands require installing dependencies first:

```bash
nvm use
npm install --prefix apps/web
```

The API uses Go plus the PostgreSQL driver:

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

Copy `.env.example` if you want local overrides:

```bash
cp .env.example .env.local
```

Docker Compose provides sensible local defaults.

## Repo layout

```text
apps/
  api/      Go API
  web/      Next.js main site
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
