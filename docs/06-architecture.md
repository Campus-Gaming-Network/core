# 06 — Architecture

Stack, runtime, ops, and engineering constraints for a single-developer, cost-conscious build.

## High-level shape

```text
Main site:  campusgamingnetwork.com
Admin Console:  admin.campusgamingnetwork.com   (separate app + release; in progress, release-gated)

Browser (React UI, TanStack Router, SSR)
        │
        ▼
Railway web service
TanStack Start BFF (TypeScript)  ── opaque cookies, loaders, server functions
        │
        ▼
Railway private networking
        │
        ▼
Railway API service
Go API / services         ── domain logic, Postgres access
        │
        ▼
Railway PostgreSQL

Side paths:
  Admin Console (TanStack Start, separate deploy; release-gated) ──► Go API
  Resend ──► transactional mail + ICS
  Cloudflare R2 ──► school logos (Admin Console); other uploads later
  Sentry ──► errors
  Cloudflare ──► DNS / edge protection
  IGDB ──► game search and import from the event and team forms, refresh from the Admin Console (Go API only)
```

**Backend for Frontend (BFF):** the TanStack Start layer shapes safe display
DTOs for UI routes; Go owns domain rules and persistence. Do not put core
business logic only in the browser.

See [14 — Architecture diagrams](./14-architecture-diagrams.md) for Mermaid views of the frontend, backend, and complete production system.

## Technology choices

| Layer            | Choice                                                        | Notes                                                                                                        |
| ---------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Frontend         | TanStack Start + React + TypeScript                           | TanStack Router, Vite, Nitro SSR, code-split routes                                                          |
| Build and test   | Vite+ (`vp`): Vite, Vitest, Oxlint, Oxfmt                     | Settings in each `vite.config.ts`; see [11](./11-implementation-decisions.md)                                |
| UI               | Semantic React + application CSS                              | Keep the runtime dependency surface small and accessible                                                     |
| BFF validation   | Zod                                                           | Runtime Go-response contracts and server-function/native-form input errors; server-only operations           |
| A11y / patterns  | GOV.UK Design System (reference)                              | Prefer accessible, clear components                                                                          |
| Server / API     | Go                                                            | All server domain code in Go                                                                                 |
| Database         | Railway PostgreSQL                                            | Backups required before public launch                                                                        |
| Local dev        | Docker                                                        | Works on all systems; develop on M1 MacBook                                                                  |
| App host         | Railway                                                       | Hosts the TanStack Start web service and Go API                                                              |
| DNS / edge       | Cloudflare                                                    | DNS and edge protection for campusgamingnetwork.com                                                          |
| Admin Console    | TanStack Start                                                | `apps/admin`, a separate release at admin.campusgamingnetwork.com; in progress and release-gated             |
| Email            | Resend                                                        | Verification, password reset, RSVP+ICS, etc.                                                                 |
| Object storage   | Cloudflare R2                                                 | School logos via Admin Console (PNG/JPG ≤5 MB); custom event banners later                                   |
| Errors           | Sentry                                                        | Web, Admin Console (each server and browser), and API failures when `SENTRY_DSN` is set; never the Admin API |
| Avatars          | Boring Avatars Beam drawn by the web app (`/api/avatars/:id`) | No avatar service is contacted; custom avatars later                                                         |
| Maps             | Google Maps embed (mini)                                      | Later nicety; address text first                                                                             |
| Games data       | IGDB import when a user picks a game                          | Not user-editable; covers stored in Postgres                                                                 |
| Analytics        | Plausible, proxied through the web origin                     | No Google Analytics; no cookies; see [13](./13-deployment-plan.md)                                           |
| Client data libs | TanStack where justified                                      | Main site uses Start/Router; Query/Table remain optional                                                     |

## Frontend guidelines

- Prefer **route loaders and SSR** over client-heavy pages
- Prefer **CSS** over adding JavaScript when CSS can solve it
- Mobile-friendly; no Internet Explorer
- Simple homepage until UGC volume justifies more
- Site-wide announcement banner support — **later**
- Feature-flag-aware UI — **later** (do not build now)

### Page metadata

- Every route carries its own title, description, and Open Graph / Twitter tags
  through its TanStack Router `head` definition and the shared helpers in
  `apps/web/src/components/public-page-head.ts` plus feature presentation
  modules.
- Every indexable page has a canonical link and a preview image
  (`/og-default.png`, 1200 by 630) with a `summary_large_image` card. A school
  page uses its logo and a `summary` card instead.
- Authenticated pages, login and signup, one-time-token flows, public profiles, unlisted events, and private events set `noIndex`. A `noindex` page has no canonical link, preview image, or structured data. See [07 — Permissions](./07-permissions.md) for the discovery rule this enforces.
- A locked private event, and an event whose audience is a campus or a group, must expose only a generic title and description. Metadata is part of the gating guarantee, not an exception to it. A public profile also gets a generic title and description, because the profile does not say whether its owner opted out of people lists.
- Structured data (JSON-LD) is limited to a public event open to everyone (`Event`, with the start and end time in the event's own UTC offset, the attendance mode, its location, and the host school as organizer), a team (`SportsTeam`), and a school (`CollegeOrUniversity`). No person's name, an online event's meeting link, or a roster is ever written to it. Event head logic lives in `apps/web/src/features/event-slice/event-head.ts`.
- `/robots.txt` allows crawlers only when `DEPLOYMENT_ENV` is `production`, and then points to `/sitemap.xml`; staging and local builds disallow everything. Pages that stay out of search use `noindex` rather than a `Disallow` rule, since a crawler that cannot fetch a page never sees its `noindex`. `/sitemap.xml` lists the fixed public pages and the slugs from the API's `GET /sitemap`.

### Error and loading boundaries

- The root router supplies safe pending, error, and not-found components; routes
  may provide tighter boundaries where their states differ.
- Error UI never renders upstream messages or rejected payloads. Missing event,
  school, team, profile, and unknown routes must return a real HTTP 404 with
  noindex metadata; production HTTP and browser tests assert this directly.
- Route definitions own status, head, and cache behavior together so streamed
  rendering cannot silently turn a missing entity into a soft 404.

### Request and cache boundaries

- Route `head` functions consume the same validated loader DTO used by the
  rendered page; they do not independently fetch the entity again.
- The root route learns the viewer on the server, so the header's account menu
  is in the first HTML and never appears late. It carries only the viewer's own
  id, name, and home school's name and slug (for Your school), nothing else
  from the profile. The menu links to View profile, Your school, Your events
  (`/account/events`), Your teams (`/account/teams`), Settings, and Log out. A request with a session cookie
  makes one upstream `/me` call and its document is `private, no-store`; a
  request without one makes no upstream call and gets the same public document
  as every other visitor. The root asks again on every navigation, so a login,
  a rename, or an expired session shows up in the header. If `/me` is
  unavailable the header falls back to the logged-out links.
- When the API answers `401 authentication_required` to a request that carried
  a session cookie, the BFF deletes that cookie and adds
  `x-cgn-session-ended` to its response. A page that is already open sees the
  header on a server-function response and reloads its routes, so the header
  shows the logged-out links and a page that needs an account redirects to the
  login page. An outage or any other error leaves the cookie alone.
- Viewer, session, account, private-event, and mutation responses are private or
  no-store. Only explicitly public catalog data receives shared freshness
  headers. TanStack Router client caching is not treated as cross-request or
  CDN caching.

### Response security headers

Each layer sets its headers once, as defaults a route can replace.

- **Web and Admin Console** (request middleware in each `src/start.ts`):
  `Content-Security-Policy` with `default-src 'self'`, `object-src 'none'`,
  `frame-ancestors 'none'`, `form-action 'self'`, `font-src 'self'`, and
  `script-src 'self' 'nonce-…'`. Each request gets a fresh nonce, and the router
  stamps it on the inline hydration scripts it renders; there is no
  `unsafe-eval`. `connect-src` is `'self'` plus the Sentry ingest origin from
  `SENTRY_DSN` when error monitoring is on. `img-src` is `'self' data:` plus
  the `R2_PUBLIC_ASSET_ORIGIN` origin for school logos. IGDB covers are proxied
  through the site, so no IGDB origin is allowed. Also sent:
  `Cross-Origin-Opener-Policy: same-origin`, `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY`, a `Permissions-Policy` that denies camera,
  microphone, geolocation, and payment, and
  `Strict-Transport-Security` (HTTPS requests when `DEPLOYMENT_ENV` is
  `production`). The web app uses `Referrer-Policy: strict-origin-when-cross-origin`.
  The Admin Console uses `no-referrer`, `Cache-Control: private, no-store`, and
  `X-Robots-Tag: noindex`, and never allows framing.
- **Go API** (`withSecurityHeaders`): `Cache-Control: no-store`,
  `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`,
  `X-Content-Type-Options`, `X-Frame-Options`, and `Referrer-Policy:
  no-referrer` on every response. A handler that serves cacheable public data
  or an image replaces `Cache-Control` or the policy itself.
- `pnpm run smoke:web` asserts the web headers and the nonce on every script
  against the production build. The Admin Console's `security-headers`
  Playwright spec does the same against its build.

### Runtime validation

- Feature-local `apps/web/src/features/*/contracts.ts` files are the source of
  truth for web-facing response schemas, form inputs, and inferred DTO types.
  Every Go success response is validated before a route can consume it.
- Feature server functions validate typed and native form input, derive cookies
  and visitor identity from the request boundary, and call server-only
  operations. Enhanced failures map to accessible field state. Valid native
  submissions use bounded post/redirect/get destinations and notices.
- Client components use type-only contract imports. They must not import Zod
  schemas at runtime.
- Zod validates the BFF boundary, not the domain. Go still owns authorization,
  state transitions, content policy, database-backed checks, and final input
  validation.
- API contract error logs include the request path and schema issues only. Never
  log the rejected payload because profile data, session-adjacent data, or event
  unlock tokens may be present.

## Backend guidelines

- Domain logic in **Go**
- Parameterized SQL; never string-concatenate user input
- Soft deletes via `deleted_at`
- Structured **system logs** for operations
- Shared **audit log** (`audit_logs`) for entity changes, kept separate from system logs
- Health check endpoints
- Rate limiting (global + signups/resend by IP and email, event creation, reports, private-event unlock, support tickets)
- Profanity filter on user-generated text fields
- **Search in Postgres first** (`pg_trgm` / `tsvector`) for schools, events, tournaments — no Elasticsearch until Postgres is proven insufficient

### Process and HTTP hardening

- `http.Server` sets `ReadHeaderTimeout` 5s, `ReadTimeout` 15s, `WriteTimeout` 30s, `IdleTimeout` 60s, and `MaxHeaderBytes` 64 KiB.
- Every request body is size limited. Public JSON bodies are capped at 1 MiB, Admin JSON bodies at 16 KiB, and school logo uploads at the logo limit plus multipart overhead. An oversized body returns `413` (`request_too_large`; `logo_too_large` for logos) through `apperror.KindTooLarge`, not `400`.
- On `SIGTERM` or interrupt the API stops accepting connections, drains in-flight requests for `API_SHUTDOWN_TIMEOUT` (default `10s`, matching Railway's `drainingSeconds`), waits for the maintenance sweeper, the club confirmation reminder job, and the email outbox worker to stop, and only then closes the database pool. Requests still running at the deadline are cut off and the process exits nonzero.
- `/health` is liveness and does not touch the database. `/ready` pings Postgres and is the Railway health check.
- The pgx pool is configured through `API_DB_MAX_CONNS` (default 10), `API_DB_MAX_CONN_LIFETIME` (`30m`), `API_DB_MAX_CONN_IDLE_TIME` (`5m`), and `API_DB_STATEMENT_TIMEOUT` (`15s`, applied as the Postgres `statement_timeout` on API connections only; the migrator and seeders do not set it).

### Catalog caching

The school and game catalogs are effectively static — roughly 6,200 schools growing by one or two a year — so they are treated as reference data rather than live queries.

- The API holds the school catalog in memory (`internal/schools/cache.go`), refreshed on an interval and on demand through `POST /internal/schools/refresh`. Reads never reach Postgres; a failed refresh keeps the previous snapshot rather than emptying the catalog, and reads fall back to Postgres before the first load completes.
- `/schools`, `/schools/:slug`, and `/games` send `Cache-Control` with `stale-while-revalidate`, so the BFF data cache, Cloudflare, and browsers all hold them. Only responses free of viewer-specific fields may be marked this way — followed schools and anything session-derived must stay uncached.
- Do not add indexes to `schools` on the assumption that search needs them. At this row count Postgres reads the whole table faster than it can use an index; the original trigram indexes were measured at zero scans and dropped in migration `000007`.

## Catalog mutations

- Schools are bootstrapped once from the Scorecard seed; users cannot create schools.
- Admin Console: school create/edit/activation/delete, school logos, school admins, and the games catalog. School commands refresh the serving process's in-memory catalog after they commit.
- Games: imported from IGDB when a user picks one; **not** editable by end users. Site admins correct, hide, delete, and refresh them. Only the Go API calls IGDB. It caches one Twitch app token in memory and stores covers in Postgres, so no page loads an image from IGDB.

## Auth & security

- Email/password with forgot/reset flows
- Frontend auth uses opaque server-side session cookies handled at the BFF; avoid JWTs for browser auth. Go validates the session/auth context for API calls.
- Railway overwrites `X-Real-IP` at the public web boundary. When Cloudflare is in front, a request transform overwrites `X-CGN-Cloudflare-Secret`, allowing the BFF to trust Cloudflare's single-value `CF-Connecting-IP`; direct Railway traffic falls back to `X-Real-IP`. The BFF forwards the normalized result in `X-CGN-Visitor-IP` only when it can authenticate the assertion to the private API with `API_PROXY_SHARED_SECRET`; the API otherwise uses its direct peer address.
- Keep one API instance while rate limits are process-local. Moving to multiple replicas requires a shared limiter so quotas cannot be multiplied across instances.
- Impersonation for site admins (audit every impersonation)
- XSS prevention (encode/sanitize output)
- SQL injection prevention (parameterized queries)
- Cloudflare for DNS and edge protection
- Support email for user issues

## Observability

| Concern        | Approach                                                                                                                                                                   |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Errors         | App/system logs; the API (`internal/errormonitor`) and the web and admin apps (`src/server/error-monitor.server.ts`, `src/error-monitor.ts` in each) also report to Sentry |
| Health         | Dedicated health checks                                                                                                                                                    |
| Audit          | Polymorphic `audit_logs` (who changed what on which entity), written in the same transaction as administrative changes and read in the Admin Console                       |
| System logs    | App/ops logging (distinct from audit)                                                                                                                                      |
| User activity  | Later user-visible activity history                                                                                                                                        |
| Entity history | Event activity log (`GET /events/:slug/activity`); school and team change history later                                                                                    |

### Logging and redaction policy

Logs and error reports never carry personal data or credentials.

- Request logs hold the method, a route template or bounded path, status, request ID, verified actor ID, and duration. Never log headers, cookies, query strings, request or response bodies, email addresses, names, tokens, or passwords.
- The API installs `internal/redact` as the default `slog` logger in every command. Attributes under a key containing `password`, `secret`, `token`, `authorization`, `cookie`, `api_key`, `email`, `recipient`, `dsn`, or `csrf` are replaced with `[redacted]`. Other string and error values have email addresses, `token=`-style query parameters, and bearer credentials masked. Do not rely on this alone: leave sensitive values out of log calls.
- Error wrapping can embed an email or token (a database constraint detail, a provider response). The scrubber masks it in logs and in Sentry, but the email outbox also keeps provider messages out of logs.
- Sentry events from the API (`errormonitor`, through `redact.Event`) and from both TanStack Start apps (`src/error-scrub.ts`, through `beforeSend`) drop request, user, breadcrumb, and stack-frame variable data. They mask the message, exception text, transaction, tags, extra data, and contexts. A browser event keeps its page URL without the query string.
- Server-side `console` logging in `*.server.ts` files names an operation or a response path and never a request body, header, or identifier supplied by a visitor.
- Add a test that captures log output or the Sentry event whenever a new log call or event field could carry visitor-supplied text.

## Feature flags (later)

**Not scheduled yet.** When added later:

- Flag entities: users, schools, events, teams
- Targeting: at least specific users and specific schools
- Evaluated server-side when possible so UI and API stay consistent

## Admin Console (in progress, release-gated)

- **TanStack Start** app in `apps/admin`, separate deploy/release after the first release; ticket status lives in [20 — Admin Console v1 engineering plan](./20-admin-console-v1-engineering-plan.md)
- URLs: main = `campusgamingnetwork.com`; Admin Console = `admin.campusgamingnetwork.com`
- Shared Go API with the main site
- Manage schools, users, ACLs, games without touching the database directly
- Only site admins create schools through the Admin Console (after one-time Scorecard seed)
- Moderation: **reports** and **support tickets** visible to admins
- Impersonation entry point (may ship after the first Admin Console release)

## Email (Resend)

- Provider: **Resend**
- Domain: `campusgamingnetwork.com`
- Keep templates simple and server-generated (Go or BFF)

| From address                            | Use for                                                                     |
| --------------------------------------- | --------------------------------------------------------------------------- |
| `events@campusgamingnetwork.com`        | Any email related to an event RSVP (confirmation, ICS, future RSVP updates) |
| `notifications@campusgamingnetwork.com` | Team and club notices (member joined, ownership, editor invites, claims)    |
| `support@campusgamingnetwork.com`       | Later support and report workflow email                                     |
| `account@campusgamingnetwork.com`       | Account emails (verification, password reset, etc.)                         |

## Object storage (Cloudflare R2)

- Provider: **Cloudflare R2**
- **School logos:** uploaded through the **Admin Console** only (not the main site).
  The Go API validates and re-encodes each image, then writes it to a dedicated
  bucket served from its own asset hostname. The main site shows a logo when a
  school has one. The web app reads `R2_PUBLIC_ASSET_ORIGIN` (optional; HTTPS
  origin in staging and production), adds it to the CSP `img-src`, and renders
  a `logo_url` only when it points under that location.
- **Local:** the `object-storage` Compose service (Adobe S3Mock, `admin`
  profile) stands in for R2.
- **Event banners:** use a default placeholder image/background — no user uploads yet (custom banners later with strict moderation)
- Allowed types: **PNG or JPG only**
- **Max size:** 5 MB per image
- Enforce type + size server-side

## Local development

- Docker Compose (or equivalent) for app + Postgres (+ mail catcher if useful)
- Must run on Apple Silicon (M1) and other developer machines
- Document one-command boot in repo root README when implemented

## Deployment & data

- First release deploys to Railway: one public TanStack Start service, one
  private Go API service, and Railway PostgreSQL.
- Cloudflare manages DNS/protection for `campusgamingnetwork.com`.
- Railway PostgreSQL backups must be enabled/verified before public launch.
- Run migrations through the existing Go migrator as a Railway pre-deploy command or dedicated migration service/job.
- Keep the Go API private to Railway networking unless a temporary public URL is needed for debugging.
- Environment-based config; secrets not in repo
- US-only product assumptions at launch (no i18n school directory yet)

See [13 — Deployment plan](./13-deployment-plan.md) for the concrete Railway topology, environment variables, launch smoke test, and rollback posture.

## Dependency policy

1. Prefer platform features and a small core set of libraries
2. Add a dependency only if it is clearly valuable, maintained, performant, and safe
3. TanStack Start and Router are the main-site framework; add Query/Table only
   when their value is demonstrated
4. Prefer semantic HTML and application CSS over a new client UI dependency

## Explicitly deferred

- WebSockets / live updates
- International schools
- Custom avatars
- Google Analytics
