# 06 — Architecture

Stack, runtime, ops, and engineering constraints for a single-developer, cost-conscious build.

## High-level shape

```text
Main site MVP:  campusgamingnetwork.com
CRM/admin app:  crm.campusgamingnetwork.com   (post-MVP separate app + separate release)

Browser (Next.js UI, Untitled UI, SSR)
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
  Post-MVP CRM (TanStack Start, separate deploy) ──► Go API
  Resend ──► transactional mail + ICS
  Cloudflare R2 ──► school logos (post-MVP CRM/admin); other uploads later
  Sentry ──► errors (post-MVP)
  Cloudflare ──► DNS / edge protection
  IGDB ──► later game enrichment (via CRM / cron); MVP uses curated seed list
```

**Backend for Frontend (BFF):** the Next.js layer shapes data for UI routes; Go owns domain rules and persistence. Do not put core business logic only in the browser.

## Technology choices

| Layer | Choice | Notes |
|-------|--------|-------|
| Frontend | Next.js + TypeScript | Server rendering important; code-split routes |
| UI kit | Untitled UI | Primary component library |
| A11y / patterns | GOV.UK Design System (reference) | Prefer accessible, clear components |
| Server / API | Go | All server domain code in Go |
| Database | Railway PostgreSQL | Backups required before public launch |
| Local dev | Docker | Works on all systems; develop on M1 MacBook |
| App host | Railway | Hosts Next.js web and Go API for MVP |
| DNS / edge | Cloudflare | DNS and edge protection for campusgamingnetwork.com |
| CRM | TanStack Start | Post-MVP separate app/release at crm.campusgamingnetwork.com |
| Email | Resend | Verification, password reset, RSVP+ICS, etc. |
| Object storage | Cloudflare R2 | Post-MVP school logos via CRM/admin app (PNG/JPG ≤500 MB); custom event banners later |
| Errors | Sentry | Post-MVP bug reporting; not required for MVP launch |
| Avatars | Gravatar with initials fallback | Custom avatars later |
| Maps | Google Maps embed (mini) | Post-MVP nicety; address text first |
| Games data | Curated MVP seed; IGDB later | Not user-editable; CRM/admin app manages later |
| Analytics | Non-GA tool (TBD) | No Google Analytics (perf) |
| Client data libs | TanStack where justified | Post-MVP CRM uses TanStack Start; Query/Table as needed |

## Frontend guidelines

- Prefer **server components / SSR** over client-heavy pages
- Prefer **CSS** over adding JavaScript when CSS can solve it
- Mobile-friendly; no Internet Explorer
- Simple homepage until UGC volume justifies more
- Site-wide announcement banner support
- Feature-flag-aware UI — **post-MVP** (do not build for MVP)

## Backend guidelines

- Domain logic in **Go**
- Parameterized SQL; never string-concatenate user input
- Soft deletes via `deleted_at`
- Shared **audit log** for entity changes
- Separate **system logs** (ops) from audit logs (domain history)
- Health check endpoints
- Rate limiting (global + signups/resend by IP and email, event creation, reports, private-event unlock, support tickets)
- Profanity filter on user-generated text fields
- **Search in Postgres first** (`pg_trgm` / `tsvector`) for schools, events, tournaments — no Elasticsearch until Postgres is proven insufficient

## Catalog mutations

- MVP: schools are bootstrapped once from the Scorecard seed; users cannot create schools.
- Post-MVP CRM/admin app: schools create/edit/delete, logo uploads, school admins, games catalog, and IGDB enrichment.
- Games: MVP uses the curated seed; **not** editable by end users.

## Auth & security

- Email/password with forgot/reset flows
- Frontend auth uses opaque server-side session cookies handled at the BFF; avoid JWTs for browser auth. Go validates the session/auth context for API calls.
- Impersonation for site admins (audit every impersonation)
- XSS prevention (encode/sanitize output)
- SQL injection prevention (parameterized queries)
- Cloudflare for DNS and edge protection
- Support email for user issues

## Observability

| Concern | Approach |
|---------|----------|
| Errors | App/system logs for MVP; Sentry post-MVP |
| Health | Dedicated health checks |
| Audit | Polymorphic `audit_logs` (who changed what on which entity) |
| System logs | App/ops logging (distinct from audit) |
| User activity | Users can view their own activity history |
| Entity history | Schools, teams, events show relevant change history |

## Feature flags (post-MVP)

**Hold off for MVP.** When added later:

- Flag entities: users, schools, events, teams
- Targeting: at least specific users and specific schools
- Evaluated server-side when possible so UI and API stay consistent

## CRM (admin application, post-MVP)

- **TanStack Start** app, separate deploy/release after the main-site MVP
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
| `notifications@campusgamingnetwork.com` | Basic notification emails |
| `support@campusgamingnetwork.com` | Support and report-related emails |
| `account@campusgamingnetwork.com` | Account emails (verification, password reset, etc.) |

## Object storage (Cloudflare R2)

- Provider: **Cloudflare R2**
- **MVP:** no user uploads; school logos use placeholders
- **Post-MVP:** school logos uploaded via **CRM/admin app** (not the main site)
- **Event banners (MVP):** use a default placeholder image/background — no user uploads yet (custom banners later with strict moderation)
- Allowed types: **PNG or JPG only**
- **Max size:** 500 MB per image
- Enforce type + size server-side

## Local development

- Docker Compose (or equivalent) for app + Postgres (+ mail catcher if useful)
- Must run on Apple Silicon (M1) and other developer machines
- Document one-command boot in repo root README when implemented

## Deployment & data

- Main-site MVP deploys to Railway: one public Next.js service, one private Go API service, and Railway PostgreSQL.
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
3. TanStack Start is the post-MVP CRM framework; other TanStack libs OK when justified
4. Untitled UI is the chosen component library for the main site

## Explicitly deferred

- WebSockets / live updates
- International schools
- Custom avatars
- Google Analytics
