# 06 — Architecture

Stack, runtime, ops, and engineering constraints for a single-developer, cost-conscious build.

## High-level shape

```text
Main site:  campusgamingnetwork.com
CRM/admin app:  crm.campusgamingnetwork.com   (later separate app + separate release)

Browser (Next.js UI, HeroUI, SSR)
        │
        ▼
Railway web service
Next.js BFF (TypeScript)  ── opaque cookie sessions, page data, form actions
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

**Backend for Frontend (BFF):** the Next.js layer shapes data for UI routes; Go owns domain rules and persistence. Do not put core business logic only in the browser.

See [14 — Architecture diagrams](./14-architecture-diagrams.md) for Mermaid views of the frontend, backend, and complete production system.

## Technology choices

| Layer | Choice | Notes |
|-------|--------|-------|
| Frontend | Next.js + TypeScript | Server rendering important; code-split routes |
| UI kit | HeroUI | Primary component library |
| BFF validation | Zod | Runtime Go-response contracts and Server Action input errors; server-side imports only |
| A11y / patterns | GOV.UK Design System (reference) | Prefer accessible, clear components |
| Server / API | Go | All server domain code in Go |
| Database | Railway PostgreSQL | Backups required before public launch |
| Local dev | Docker | Works on all systems; develop on M1 MacBook |
| App host | Railway | Hosts Next.js web and Go API for now |
| DNS / edge | Cloudflare | DNS and edge protection for campusgamingnetwork.com |
| CRM | TanStack Start | Later separate app/release at crm.campusgamingnetwork.com |
| Email | Resend | Verification, password reset, RSVP+ICS, etc. |
| Object storage | Cloudflare R2 | School logos via CRM/admin app (PNG/JPG ≤500 MB), then custom event banners — both later |
| Errors | Sentry | Later bug reporting; not required for launch |
| Avatars | Gravatar with initials fallback | Custom avatars later |
| Maps | Google Maps embed (mini) | Later nicety; address text first |
| Games data | Curated seed; IGDB later | Not user-editable; CRM/admin app takes over management |
| Analytics | Non-GA tool (TBD) | No Google Analytics (perf) |
| Client data libs | TanStack where justified | Later CRM uses TanStack Start; Query/Table as needed |

## Frontend guidelines

- Prefer **server components / SSR** over client-heavy pages
- Prefer **CSS** over adding JavaScript when CSS can solve it
- Mobile-friendly; no Internet Explorer
- Simple homepage until UGC volume justifies more
- Site-wide announcement banner support — **later**
- Feature-flag-aware UI — **later** (do not build now)

### Page metadata

- Every route carries its own title, description, and Open Graph / Twitter tags through the `pageMetadata` helper in `apps/web/lib/metadata.ts`. The root layout owns the title template and `metadataBase`.
- Authenticated pages, one-time-token flows, private events, and unlisted events set `noIndex`. See [07 — Permissions](./07-permissions.md) for the discovery rule this enforces.
- A locked private event must expose only a generic title and description. Metadata is part of the gating guarantee, not an exception to it.

### Error and loading boundaries

- `error.tsx`, `global-error.tsx`, and `not-found.tsx` live at the app root. Error UI shows `error.digest` only — never `error.message`, which can carry API internals.
- **Never add a `loading.tsx` to a segment that contains a route calling `notFound()`.** A `loading.tsx` opens a Suspense boundary over its whole subtree, so the response begins streaming and commits a 200 before the page can set a 404. Every missing event, school, team, and profile then answers 200 with not-found content — a soft 404 that renders correctly and is invisible unless you check the status code.
- Browse pages live in `(browse)` route groups for exactly this reason: the group scopes their loading boundary to the list page and keeps it off the sibling `[slug]` detail routes. URLs are unaffected by the group.

### Request memoization

- Per-request getters in `apps/web/lib/server-api.ts` are wrapped in React `cache()`. `apiRequest` defaults to `cache: "no-store"`, which Next.js does **not** deduplicate, so without this a route's `generateMetadata` and its page body would each issue the same API call.
- `cache()` compares arguments by reference, so wrapped functions take primitives rather than options objects. `getEvent` and `getTeam` flatten their options before calling the cached inner function.

### Runtime validation

- `apps/web/lib/api-contracts.ts` is the source of truth for web-facing response
  schemas and inferred DTO types. Every `apiRequest` supplies a schema, including
  `emptyResponseSchema` for a 204.
- `apps/web/lib/form-validation.ts` validates normalized Server Action input and
  maps expected failures into accessible per-field form state. Browser-native
  constraints stay in place for immediate and progressive-enhancement feedback.
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

- First release deploys to Railway: one public Next.js service, one private Go API service, and Railway PostgreSQL.
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
3. TanStack Start is the later CRM framework; other TanStack libs OK when justified
4. HeroUI is the chosen component library for the main site

## Explicitly deferred

- WebSockets / live updates
- International schools
- Custom avatars
- Google Analytics
