# 11 — Implementation decisions

Small, concrete engineering choices for Phase 0 and early early implementation. These decisions keep the scaffold boring, explicit, and easy to change before real users.

## Phase 0 decisions

| Area | Decision |
|------|----------|
| Repo layout | Monorepo with `apps/web`, `apps/api`, `apps/docs`, `db/migrations`, `docs`, `data`, and `scripts` |
| Application containers | Every direct child of `apps/` is a runnable application and must have an `apps/<name>/Dockerfile` plus a same-named service in `docker-compose.yml` that builds it. Optional applications may use Compose profiles. `npm run check:apps-compose` enforces the convention locally and in CI. |
| Node.js | Node 24 for local development, CI, and Docker web runtime |
| Main site | TanStack Start + TanStack Router + React + TypeScript; Vite builds the client and Nitro production server |
| Web linting | Oxlint for fast JavaScript/TypeScript linting; TypeScript remains the type-safety gate. Package versions are pinned exactly and upgraded intentionally. |
| npm package versions | Pin exact npm package versions. Do not use `^`, `~`, `latest`, or broad semver ranges when adding or updating packages. |
| Dependency security | `npm audit --omit=dev` must report zero vulnerabilities before a release, and `go list -m -u all` should show no updates for modules in the API build graph. Treat advisory-clearing upgrades as their own commit, separate from lint or tooling churn. |
| Type package versions | `@types/node` tracks the pinned Node major (24.x), not the newest release. Types ahead of the runtime admit APIs that do not exist at run time. |
| Page metadata | Each route owns title, description, Open Graph, Twitter, robots, and canonical behavior through its TanStack Router `head` definition. Public routes share `apps/web/src/components/public-page-head.ts`; the root owns only document-wide metadata and the stylesheet. Open Graph images are deferred until a share asset exists. |
| Search indexing | `noindex` on authenticated pages, one-time-token flows, private events, and unlisted events. |
| Route boundaries | TanStack Router root and route definitions own pending, error, and not-found components. Direct HTTP tests assert true 404 status codes for missing entities; rendering the expected body alone is not sufficient. Shared safe UI lives in `apps/web/src/components/route-boundaries.tsx`. |
| Request and cache policy | Route loaders call narrow server functions. Viewer and token data is explicitly private/no-store; the root SSR payload remains viewer-neutral and discovers navigation authentication separately through `/api/navigation-session`. Public catalog freshness follows Go cache headers and explicit server request policy. TanStack Router's in-browser cache is not treated as cross-request server caching. |
| BFF response contracts | Pin Zod and require a runtime schema for every successful request through `apps/web/src/server/api.server.ts`. Define schemas and inferred DTO types together in feature-local `apps/web/src/features/*/contracts.ts` files; allow additive response fields, reject missing/invalid consumed fields, and never log rejected payloads. |
| Server function and form validation | Validate typed input or normalized `FormData` with feature-local schemas before calling Go. Enhanced submissions return serializable, accessible field errors. Valid native submissions work without JavaScript and use 303 redirects; invalid or upstream-failed native submissions currently use bounded redirect notices rather than retaining every submitted value. Native HTML constraints remain in place. Go remains authoritative for domain, authorization, persistence, resource-state, and content-policy rules. |
| School catalog reads | Served from an in-process snapshot in the API (`internal/schools/cache.go`), reloaded on `API_CATALOG_REFRESH_INTERVAL` and on demand via `POST /internal/schools/refresh`. The catalog is ~1.4 MB and changes once or twice a year, so keeping it in memory removes the Postgres round trip — a cross-service hop on Railway — from every browse, search, and detail read. Follows stay on Postgres because they are per-user. |
| Catalog HTTP caching | `/schools`, `/schools/:slug`, and `/games` send `Cache-Control: public, max-age=300, stale-while-revalidate=86400`, and catalog server functions may use cacheable requests for those reads. Only responses with no viewer-specific fields may carry this. |
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
| Production hosting | Railway hosts the TanStack Start/Nitro web service, Go API, and PostgreSQL; Cloudflare manages DNS/protection |
| Railway topology | Services are named `web`, `api`, and `postgres`; staging rehearsal precedes production; API migrations run as pre-deploy; Cloudflare redirects `www` to the apex domain |
| Deployment safety mode | `DEPLOYMENT_ENV` is `local`, `staging`, or `production`. Direct development defaults to `local`, production container images default to `production`, and Compose explicitly selects `local`. `apps/web/src/production-preflight.ts` and the API use the same fail-closed checks in staging and production. `NODE_ENV` is not a deployment trust signal because local production builds also set it. Local mode alone permits localhost URLs, insecure cookies, and disabled external email/edge credentials. |
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
| Series editing | No edit-series workflow yet. Occurrences are edited and cancelled independently. Edit forms do not expose recurrence controls, and the web server function plus API reject supplied recurrence fields. |
| Event time entry | Create/edit forms accept local wall-clock values through native `datetime-local` controls and use a curated US timezone selector defaulted from the profile. The web server function converts valid local values to UTC instants before calling Go. Nonexistent spring-forward times and ambiguous fall-back times are rejected rather than guessed; `CGN-008` still owns recurrence generation and its duration rule across DST. |
| Cancellation email | After soft cancellation, send a best-effort email from `events@campusgamingnetwork.com` to active `yes`/`maybe` RSVPs. Email failure is logged and does not roll back cancellation; no ICS is attached. |

## Trust and safety decisions

| Area | Decision |
|------|----------|
| School-admin role | Store school-scoped grants in `school_admins`; grants are soft-revocable and future CRM/admin tooling owns assignment. Public profiles expose `school_admin` when a user has an active grant. |
| Staff/faculty role | Use the existing `staff_faculty` verification level as the visible staff/faculty role indicator. |
| Event organizer badges | Event detail responses include organizer summaries. Show `school_admin` for an active grant at the event's host school and `staff_faculty` for verified staff/faculty. |
| Verified-student email rule | When inbox verification succeeds, promote a `basic` account only when the normalized email domain is a syntactically valid domain ending exactly in `.edu`. Subdomains qualify; mixed case is normalized; lookalikes such as `school.edu.com` do not qualify. There is no exclusion list yet. Existing `verified`, `staff_faculty`, and future higher levels are never downgraded. The badge is a limited inbox-domain trust signal, not proof of enrollment, current affiliation, or identity. A future email-change feature must re-evaluate and explicitly define downgrade behavior before launch. |
| Basic content filtering | Reject a small word-boundary blocked-term list in names, bios, event titles/descriptions/location/payment notes, team names/descriptions, reports, and support messages. This is an intake guard, not a replacement for moderation. |

## Initial folder responsibilities

```text
apps/web       Main user-facing site and BFF route handlers
apps/api       Go API that owns validation, authorization, side effects, and persistence
apps/docs      Local viewer for the Markdown product and engineering documentation
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
| TanStack Start frontend | Tests for changed components, loaders, server routes, server functions, native forms, and user-visible pending/error/empty/success states. Keep accessibility behavior covered where the UI changes. Run typecheck, lint, unit tests, the browser suite against Vite and built Nitro where relevant, and the production build. |
| Migrations and seed/import code | Test migration parsing/idempotency and import validation; run the affected migration/import against a disposable or local Postgres database when practical. |
| CI | Pull requests must run backend tests and frontend type/lint/test checks. Do not lower existing coverage or remove regression tests to make a change pass. |

Prefer focused regression tests for bugs and meaningful behavior coverage over
tests that only assert implementation details. When a test runner or coverage
threshold is introduced for a layer, add it to CI and keep the threshold
ratcheting upward rather than treating coverage as a one-time report.

## Deferred to later hardening

- Sentry SDK integration (later)
- CRM/admin app
- TypeScript 7 adoption; revisit when the pinned TanStack Start, Vite, Nitro,
  and related type tooling support it together
- User-visible activity history and the notification UI/API
