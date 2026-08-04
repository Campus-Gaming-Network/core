# 11 — Implementation decisions

Small, concrete engineering choices for Phase 0 and early early implementation. These decisions keep the scaffold boring, explicit, and easy to change before real users.

## Phase 0 decisions

| Area | Decision |
|------|----------|
| Repo layout | Monorepo with `apps/web`, `apps/api`, `db/migrations`, `docs`, `data`, and `scripts` |
| Node.js | Node 24 for local development, CI, and Docker web runtime |
| Main site | Next.js 16 + TypeScript App Router |
| Web linting | Oxlint for fast JavaScript/TypeScript linting; TypeScript remains the type-safety gate. Package versions are pinned exactly and upgraded intentionally. |
| npm package versions | Pin exact npm package versions. Do not use `^`, `~`, `latest`, or broad semver ranges when adding or updating packages. |
| Dependency security | `npm audit --omit=dev` must report zero vulnerabilities before a release, and `go list -m -u all` should show no updates for modules in the API build graph. Treat advisory-clearing upgrades as their own commit, separate from lint or tooling churn. |
| Type package versions | `@types/node` tracks the pinned Node major (24.x), not the newest release. Types ahead of the runtime admit APIs that do not exist at run time. |
| Page metadata | Per-page title, description, Open Graph, and Twitter tags via `apps/web/lib/metadata.ts`; the root layout owns the title template and `metadataBase`. Open Graph images are deferred until a share asset exists. |
| Search indexing | `noindex` on authenticated pages, one-time-token flows, private events, and unlisted events. |
| Route loading boundaries | Browse pages sit in `(browse)` route groups so their `loading.tsx` never wraps a `notFound()` route. See the soft-404 constraint in [06 — Architecture](./06-architecture.md). |
| Request memoization | Per-request getters in `lib/server-api.ts` wrap React `cache()`, because `apiRequest` defaults to `cache: "no-store"` and Next.js does not deduplicate those. `cache()` compares by reference, so wrapped functions take primitives rather than options objects. |
| API | Go REST/JSON HTTP service |
| Go version | Go 1.25 minimum, set by the `go` directive in `apps/api/go.mod`. Go 1.21 reached end of life, and the current `pgx` and `golang.org/x/*` releases require 1.25 or newer. CI installs the version from `go.mod`; the API image builds on `golang:1.25-alpine`. |
| Go dependencies | Standard library first; add dependencies only when Phase 1 needs them |
| Frontend auth | Opaque server-side session cookies; no browser JWT auth |
| Auth session backing | Postgres-backed opaque server-side sessions |
| Password hashing | Argon2id (`m=19456`, `t=2`, `p=1`), stored as a PHC string so parameters travel with each hash. Verification reads them back per-hash, so the cost can be raised later without a rehash-on-login migration. bcrypt hashes still verify for databases seeded before the switch; nothing writes them. The same functions hash team join and private event passwords, so each concurrent verification holds ~19 MiB. |
| Primary keys | Use UUIDs for domain tables unless a later migration ADR overrides this |
| Migrations | Keep first migrations scoped to shipped features; use timestamped/versioned SQL files in `db/migrations` |
| Database readiness | Phase 0 `/ready` checks Postgres network reachability; real SQL checks arrive with the DB driver |
| Production hosting | Railway hosts Next.js web, Go API, and PostgreSQL; Cloudflare manages DNS/protection |
| Railway topology | Services are named `web`, `api`, and `postgres`; staging rehearsal precedes production; API migrations run as pre-deploy; Cloudflare redirects `www` to the apex domain |
| CRM | Not in the first release; the CRM/admin app comes later |
| Branch campuses | Same UI/UX as other schools |
| Paid events | Supports off-site-payment listings only; no CGN payment processing |
| Audit/activity/notifications | Database-backed domain audit history, user activity history, and in-app notifications are later. Uses structured operational logs plus account and RSVP transactional email. |

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

## Deferred to later hardening

- Sentry SDK integration (later)
- CRM/admin app
- TypeScript 7 adoption; revisit when Next.js officially supports it
- Database-backed audit/activity history and in-app notifications
