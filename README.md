# Campus Gaming Network

Central hub for collegiate gamers: discover schools, events, teams, and campus gaming activity.

The product/domain docs live in [`docs/`](./docs/README.md). This root README covers the local Phase 0 scaffold.

## Phase 0 status

This repo currently contains a minimal foundation:

- `apps/web` — Next.js main-site shell
- `apps/api` — Go API with `/health` and `/ready`
- `db/migrations` — first foundation SQL, kept MVP-only
- `docker-compose.yml` — web + API + Postgres
- `.github/workflows/ci.yml` — initial CI checks

No auth, school import, event, team, or CRM flows are implemented yet.

## Quick start

```bash
docker compose up --build
```

Then open:

- Web: http://localhost:3000
- API health: http://localhost:8080/health
- API readiness: http://localhost:8080/ready

The first run downloads Node and Go dependencies in Docker. Postgres initializes with `db/migrations/000001_foundation.up.sql` only when the database volume is first created.

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

The API currently uses only the Go standard library:

```bash
cd apps/api
go test ./...
go run ./cmd/api
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
