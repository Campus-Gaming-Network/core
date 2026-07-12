# 11 — Implementation decisions

Small, concrete engineering choices for Phase 0 and early MVP implementation. These decisions keep the scaffold boring, explicit, and easy to change before real users.

## Phase 0 decisions

| Area | Decision |
|------|----------|
| Repo layout | Monorepo with `apps/web`, `apps/api`, `db/migrations`, `docs`, `data`, and `scripts` |
| Node.js | Node 24 for local development, CI, and Docker web runtime |
| Main site | Next.js 16 + TypeScript App Router |
| Web linting | Oxlint for fast JavaScript/TypeScript linting; TypeScript remains the type-safety gate. Package versions are pinned exactly and upgraded intentionally. |
| npm package versions | Pin exact npm package versions. Do not use `^`, `~`, `latest`, or broad semver ranges when adding or updating packages. |
| API | Go REST/JSON HTTP service |
| Go version | Go 1.21 for local compatibility |
| Go dependencies | Standard library first; add dependencies only when Phase 1 needs them |
| Frontend auth | Opaque server-side session cookies; no browser JWT auth |
| Auth session backing | Postgres-backed opaque server-side sessions |
| Primary keys | Use UUIDs for domain tables unless a later migration ADR overrides this |
| Migrations | Keep first migrations MVP-only; use timestamped/versioned SQL files in `db/migrations` |
| Database readiness | Phase 0 `/ready` checks Postgres network reachability; real SQL checks arrive with the DB driver |
| MVP production hosting | Railway hosts Next.js web, Go API, and PostgreSQL; Cloudflare manages DNS/protection |
| CRM | Skipped for MVP; CRM/admin app remains post-MVP |
| Branch campuses | Same UI/UX as other schools |
| Paid events | MVP supports off-site-payment listings only; no CGN payment processing |

## Initial folder responsibilities

```text
apps/web       Main user-facing site and BFF route handlers
apps/api       Go API that owns validation, authorization, side effects, and persistence
db/migrations  Versioned SQL migrations
docs           Product, architecture, API, permissions, and delivery docs
data           Tracked slim seed data only
scripts        Local/dev utilities
```

## Testing and coverage expectation

Every frontend or backend code change must include new tests or update existing
tests for the behavior it changes. A change is not complete when it only
compiles or renders on the happy path.

| Area | Minimum expectation |
|------|---------------------|
| Go backend | Unit tests for validation and domain logic; repository/API tests for SQL, authentication, authorization, error cases, and important state transitions. Run `go test ./...` and `go vet ./...`. |
| Next.js frontend | Tests for changed components, route handlers, server actions, and user-visible loading/error/empty/success states. Keep accessibility behavior covered where the UI changes. Run typecheck and lint in addition to the test suite. |
| Migrations and seed/import code | Test migration parsing/idempotency and import validation; run the affected migration/import against a disposable or local Postgres database when practical. |
| CI | Pull requests must run backend tests and frontend type/lint/test checks. Do not lower existing coverage or remove regression tests to make a change pass. |

Prefer focused regression tests for bugs and meaningful behavior coverage over
tests that only assert implementation details. When a test runner or coverage
threshold is introduced for a layer, add it to CI and keep the threshold
ratcheting upward rather than treating coverage as a one-time report.

## Deferred until post-MVP / later hardening

- Sentry SDK integration (post-MVP)
- CRM/admin app
- TypeScript 7 adoption; revisit when Next.js officially supports it
