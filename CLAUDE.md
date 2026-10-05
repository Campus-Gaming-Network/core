# CLAUDE.md

@AGENTS.md

## Branches and pull requests

- `next` is the working branch and the default branch. Branch from `next` and
  open every pull request against `next`. Do not target `main`.
- Tasks are tracked in GitHub Issues and the "CGN core" project board, not in
  markdown. Reference the issue in the pull request ("Closes #123").
- One issue per pull request. If an issue's "Done when" line cannot be met,
  say so in the pull request instead of narrowing the scope silently.
- Issues labeled `needs-human` or `needs-spec` are not ready to implement.

## Layout

- `apps/web`: public site (TanStack Start)
- `apps/admin`: Admin Console (TanStack Start, separate deployment)
- `apps/api`: Go API
- `apps/docs`: VitePress viewer for `docs/`
- `db/migrations`: versioned SQL migrations
- `docs/`: product and engineering docs; `docs/README.md` says which doc owns
  which fact

## Install and run

Use Node.js 24 (`.node-version`), pnpm 12, and the Go version in
`apps/api/go.mod`.

```bash
pnpm install --frozen-lockfile
pnpm run compose:up          # web, API, and Postgres
pnpm run compose:up:admin    # the above plus the Admin Console, signed in locally
```

Use `compose:up:admin` for the Admin Console. A plain `docker compose up`
leaves its admin settings unset and the console refuses access.

- Web: http://localhost:3000
- Admin Console: http://localhost:3002
- API health: http://localhost:8080/health

## Test, lint, and format

Run the checks for the area you changed.

| Area                   | Commands                                                                   |
| ---------------------- | -------------------------------------------------------------------------- |
| Everything             | `pnpm run fmt` (then `pnpm run fmt:check`)                                 |
| Go API                 | `pnpm run fmt:api`, `pnpm run vet:api`, `pnpm run test:api`                |
| Web                    | `pnpm run typecheck:web`, `pnpm run lint:web`, `pnpm run test:web`         |
| Web, browser-visible   | `pnpm run test:e2e:web:dev`, `pnpm run build:web`, `pnpm run test:e2e:web` |
| Admin                  | `pnpm run typecheck:admin`, `pnpm run lint:admin`, `pnpm run test:admin`   |
| Admin, browser-visible | `pnpm run build:admin`, `pnpm run test:e2e:admin`                          |
| Docs                   | `pnpm run check:docs-links`                                                |
| Apps or Compose        | `pnpm run check:apps-compose`                                              |

- The Playwright suites for web and admin serve the existing `.output` build.
  Always rebuild immediately before running them.
- Database-backed Go tests are skipped unless `API_DATABASE_URL` is set. With
  the Compose stack up, use
  `postgres://cgn:cgn@localhost:5432/cgn?sslmode=disable`.

## Conventions

- Go follows `docs/go-style.md`: explicit error handling with early returns,
  preserved initialisms (`ID`, `URL`), and doc comments on exported names.
- The Admin API uses named operations with their own validation,
  authorization, and audit. Do not add generic CRUD endpoints.
- The web and admin apps validate every API response with Zod at the server
  boundary. Server-only code lives in `*.server.ts` files.
- Mutations use native forms with progressive enhancement and must work
  without JavaScript.
- The Admin Console never displays a record ID. Show the name and link to the
  record; offer a "Copy <entity> ID" button where an ID is needed.
- The Admin Console loads no third-party scripts, analytics, or remote fonts.
- Commit messages use the `type(scope): summary` form, for example
  `feat(admin): ...` or `test(web): ...`.

## Review checklist

- The pull request targets `next` and names the issue it closes.
- The issue's "Done when" line is met, with a test that proves it.
- The checks for each changed area pass, including a fresh build before any
  Playwright run.
- New tests are deterministic: no sleeps, wall-clock timing, or dependence on
  execution order.
- A changed endpoint, field, permission, or rule is updated in the doc that
  owns it.
- No secrets, credentials, or real personal data in code, fixtures, or logs.
- Admin changes keep capability checks, CSRF protection, and audit writes.
