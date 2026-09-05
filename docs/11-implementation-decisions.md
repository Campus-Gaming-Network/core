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
| BFF response contracts | Pin Zod and require a runtime schema for every successful `apiRequest`. Define schemas and inferred DTO types together in `apps/web/lib/api-contracts.ts`; allow additive response fields, reject missing/invalid consumed fields, and never log rejected payloads. |
| Server Action validation | Validate normalized `FormData` with schemas in `apps/web/lib/form-validation.ts` before calling Go. Return serializable, accessible field errors while retaining native HTML constraints. Go remains authoritative for domain, authorization, persistence, resource-state, and content-policy rules. |
| School catalog reads | Served from an in-process snapshot in the API (`internal/schools/cache.go`), reloaded on `API_CATALOG_REFRESH_INTERVAL` and on demand via `POST /internal/schools/refresh`. The catalog is ~1.4 MB and changes once or twice a year, so keeping it in memory removes the Postgres round trip — a cross-service hop on Railway — from every browse, search, and detail read. Follows stay on Postgres because they are per-user. |
| Catalog HTTP caching | `/schools`, `/schools/:slug`, and `/games` send `Cache-Control: public, max-age=300, stale-while-revalidate=86400`, and the BFF passes `revalidate` instead of `no-store` for those three reads. Only responses with no viewer-specific fields may carry this. |
| School search indexes | No trigram indexes. At ~6,200 rows across ~192 pages a sequential scan matches a forced index scan (5.3 ms vs 5.4 ms), and the two GIN indexes recorded zero scans while occupying four times the table's size. Migration `000007` drops them. Revisit only with a purpose-built similarity index if typo-tolerant search is added. |
| API | Go REST/JSON HTTP service |
| Go version | Go 1.27.1 minimum, set by the `go` directive in `apps/api/go.mod`. Go 1.25 is no longer supported under the [Go release policy](https://go.dev/doc/devel/release). CI installs the version from `go.mod`; local formatting uses that selected toolchain's `gofmt`. The API image builds on `golang:1.27.1-alpine3.24` and runs on `alpine:3.24`. Update the module directive and builder image together when adopting a Go patch release. |
| Go dependencies | Standard library first; add dependencies only when Phase 1 needs them |
| Frontend auth | Opaque server-side session cookies; no browser JWT auth |
| Auth session backing | Postgres-backed opaque server-side sessions |
| Password hashing | Argon2id (`m=19456`, `t=2`, `p=1`), stored as a PHC string so parameters travel with each hash. Verification reads them back per-hash, so the cost can be raised later without a rehash-on-login migration. bcrypt hashes still verify for databases seeded before the switch; nothing writes them. The same functions hash team join and private event passwords, so each concurrent verification holds ~19 MiB. |
| Primary keys | Use UUIDs for domain tables unless a later migration ADR overrides this |
| Migrations | Keep first migrations scoped to shipped features; use timestamped/versioned SQL files in `db/migrations` |
| Database readiness | Phase 0 `/ready` checks Postgres network reachability; real SQL checks arrive with the DB driver |
| Production hosting | Railway hosts Next.js web, Go API, and PostgreSQL; Cloudflare manages DNS/protection |
| Railway topology | Services are named `web`, `api`, and `postgres`; staging rehearsal precedes production; API migrations run as pre-deploy; Cloudflare redirects `www` to the apex domain |
| BFF visitor identity | Railway's public proxy overwrites `X-Real-IP`. Behind Cloudflare, the BFF accepts `CF-Connecting-IP` only with an edge-overwritten `X-CGN-Cloudflare-Secret` matching `CLOUDFLARE_ORIGIN_SECRET`; otherwise it uses Railway's address. It forwards the normalized result as `X-CGN-Visitor-IP`, authenticated to the private API by `API_PROXY_SHARED_SECRET`. The API ignores missing, malformed, or unauthenticated assertions and falls back to its peer address. |
| Rate-limit dimensions | Anonymous account flows use visitor buckets plus normalized-email or opaque-token sub-buckets where applicable; private unlocks use event + visitor; authenticated creation, report, and team-join flows use stable account buckets (with the team target for joins). The limiter is process-local, so keep one API instance until a shared limiter replaces it. |
| CRM | Not in the first release; the CRM/admin app comes later |
| Branch campuses | Same UI/UX as other schools |
| Paid events | Supports off-site-payment listings only; no CGN payment processing |
| Audit/activity/notifications | Migration `000010` adds append-oriented domain audit history and per-user in-app notifications. Moderation queue patches write audits transactionally; notification reads are user-scoped. User activity history, authenticated notification endpoints/UI, and the site-admin CRM remain later. System/ops logs stay separate. |
| Queue retention | Reports and support tickets start `retention_started_at` when they enter `resolved` or `closed`; terminal-to-terminal changes preserve it, reopening clears it, and a later terminal transition starts a new clock. Target windows and the legal-hold/purge work are tracked in doc 16. |

## Current event lifecycle decisions

| Area | Decision |
|------|----------|
| Recurrence | Creation supports weekly, biweekly, and monthly schedules through an inclusive end date no more than one year after the first occurrence. Each occurrence is a normal event row with its own slug, RSVPs, and cancellation lifecycle. |
| Series editing | No edit-series workflow yet. Occurrences are edited and cancelled independently. |
| Cancellation email | After soft cancellation, send a best-effort email from `events@campusgamingnetwork.com` to active `yes`/`maybe` RSVPs. Email failure is logged and does not roll back cancellation; no ICS is attached. |

## Trust and safety decisions

| Area | Decision |
|------|----------|
| School-admin role | Store school-scoped grants in `school_admins`; grants are soft-revocable and future CRM/admin tooling owns assignment. Public profiles expose `school_admin` when a user has an active grant. |
| Staff/faculty role | Use the existing `staff_faculty` verification level as the visible staff/faculty role indicator. |
| Event organizer badges | Event detail responses include organizer summaries. Show `school_admin` for an active grant at the event's host school and `staff_faculty` for verified staff/faculty. |
| Basic content filtering | Reject a small word-boundary blocked-term list in names, bios, event titles/descriptions/location/payment notes, team names/descriptions, reports, and support messages. This is an intake guard, not a replacement for moderation. |

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
- User-visible activity history and the notification UI/API
