# 06 — Architecture

Stack, runtime, ops, and engineering constraints for a single-developer, cost-conscious build.

## High-level shape

```text
Main site:  campusgamingnetwork.com
CRM/admin app:  crm.campusgamingnetwork.com   (later separate app + separate release)

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
  Later CRM (TanStack Start, separate deploy) ──► Go API
  Resend ──► transactional mail + ICS
  Cloudflare R2 ──► school logos (CRM/admin, later); other uploads after that
  Sentry ──► errors (later)
  Cloudflare ──► DNS / edge protection
  IGDB ──► later game enrichment (via CRM / cron); uses the curated seed list
```

**Backend for Frontend (BFF):** the TanStack Start layer shapes safe display
DTOs for UI routes; Go owns domain rules and persistence. Do not put core
business logic only in the browser.

See [14 — Architecture diagrams](./14-architecture-diagrams.md) for Mermaid views of the frontend, backend, and complete production system.

## Technology choices

| Layer | Choice | Notes |
|-------|--------|-------|
| Frontend | TanStack Start + React + TypeScript | TanStack Router, Vite, Nitro SSR, code-split routes |
| UI | Semantic React + application CSS | Keep the runtime dependency surface small and accessible |
| BFF validation | Zod | Runtime Go-response contracts and server-function/native-form input errors; server-only operations |
| A11y / patterns | GOV.UK Design System (reference) | Prefer accessible, clear components |
| Server / API | Go | All server domain code in Go |
| Database | Railway PostgreSQL | Backups required before public launch |
| Local dev | Docker | Works on all systems; develop on M1 MacBook |
| App host | Railway | Hosts the TanStack Start web service and Go API |
| DNS / edge | Cloudflare | DNS and edge protection for campusgamingnetwork.com |
| CRM | TanStack Start | Later separate app/release at crm.campusgamingnetwork.com |
| Email | Resend | Verification, password reset, RSVP+ICS, etc. |
| Object storage | Cloudflare R2 | School logos via CRM/admin app (PNG/JPG ≤500 MB), then custom event banners — both later |
| Errors | Sentry | Later bug reporting; not required for launch |
| Avatars | DiceBear Critters default preset with initials fallback | Custom avatars later |
| Maps | Google Maps embed (mini) | Later nicety; address text first |
| Games data | Curated seed; IGDB later | Not user-editable; CRM/admin app takes over management |
| Analytics | Non-GA tool (TBD) | No Google Analytics (perf) |
| Client data libs | TanStack where justified | Main site uses Start/Router; Query/Table remain optional |

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
- Authenticated pages, one-time-token flows, private events, and unlisted events set `noIndex`. See [07 — Permissions](./07-permissions.md) for the discovery rule this enforces.
- A locked private event must expose only a generic title and description. Metadata is part of the gating guarantee, not an exception to it.

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
- The root SSR loader is viewer-neutral. Client navigation decoration uses the
  private, no-store `/api/navigation-session` endpoint so public documents do
  not serialize a profile or vary unnecessarily by session.
- Viewer, session, account, private-event, and mutation responses are private or
  no-store. Only explicitly public catalog data receives shared freshness
  headers. TanStack Router client caching is not treated as cross-request or
  CDN caching.

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
- Later shared **audit log** for entity changes, kept separate from system logs
- Health check endpoints
- Rate limiting (global + signups/resend by IP and email, event creation, reports, private-event unlock, support tickets)
- Profanity filter on user-generated text fields
- **Search in Postgres first** (`pg_trgm` / `tsvector`) for schools, events, tournaments — no Elasticsearch until Postgres is proven insufficient

### Catalog caching

The school and game catalogs are effectively static — roughly 6,200 schools growing by one or two a year — so they are treated as reference data rather than live queries.

- The API holds the school catalog in memory (`internal/schools/cache.go`), refreshed on an interval and on demand through `POST /internal/schools/refresh`. Reads never reach Postgres; a failed refresh keeps the previous snapshot rather than emptying the catalog, and reads fall back to Postgres before the first load completes.
- `/schools`, `/schools/:slug`, and `/games` send `Cache-Control` with `stale-while-revalidate`, so the BFF data cache, Cloudflare, and browsers all hold them. Only responses free of viewer-specific fields may be marked this way — followed schools and anything session-derived must stay uncached.
- Do not add indexes to `schools` on the assumption that search needs them. At this row count Postgres reads the whole table faster than it can use an index; the original trigram indexes were measured at zero scans and dropped in migration `000007`.

## Catalog mutations

- Schools are bootstrapped once from the Scorecard seed; users cannot create schools.
- Later CRM/admin app: schools create/edit/delete, logo uploads, school admins, games catalog, and IGDB enrichment.
- Games: Uses the curated seed; **not** editable by end users.

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

| Concern | Approach |
|---------|----------|
| Errors | App/system logs for now; Sentry later |
| Health | Dedicated health checks |
| Audit | Later polymorphic `audit_logs` (who changed what on which entity) |
| System logs | App/ops logging (distinct from audit) |
| User activity | Later user-visible activity history |
| Entity history | Later school, team, and event change history |

## Feature flags (later)

**Not scheduled yet.** When added later:

- Flag entities: users, schools, events, teams
- Targeting: at least specific users and specific schools
- Evaluated server-side when possible so UI and API stay consistent

## CRM (admin application, later)

- **TanStack Start** app, separate deploy/release after the first release
- URLs: main = `campusgamingnetwork.com`; CRM = `crm.campusgamingnetwork.com`
- Shared Go API with the main site
- Manage schools, users, ACLs, games without touching the database directly
- Only site admins create schools through CRM/admin tooling (after one-time Scorecard seed)
- Moderation: **reports** and **support tickets** visible to admins
- Impersonation entry point (may ship after first CRM release)

## Email (Resend)

- Provider: **Resend**
- Domain: `campusgamingnetwork.com`
- Keep templates simple and server-generated (Go or BFF)

| From address | Use for |
|--------------|---------|
| `events@campusgamingnetwork.com` | Any email related to an event RSVP (confirmation, ICS, future RSVP updates) |
| `notifications@campusgamingnetwork.com` | Later basic notification emails |
| `support@campusgamingnetwork.com` | Later support and report workflow email |
| `account@campusgamingnetwork.com` | Account emails (verification, password reset, etc.) |

## Object storage (Cloudflare R2)

- Provider: **Cloudflare R2**
- **Now:** no user uploads; school logos use placeholders
- **Later:** school logos uploaded via **CRM/admin app** (not the main site)
- **Event banners:** use a default placeholder image/background — no user uploads yet (custom banners later with strict moderation)
- Allowed types: **PNG or JPG only**
- **Max size:** 500 MB per image
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
