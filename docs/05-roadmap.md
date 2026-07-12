# 05 — Roadmap

Phased delivery for a single developer. Each phase should be shippable. Do not pull later-phase work forward without a clear need.

**URLs:** main site MVP = `campusgamingnetwork.com` · CRM/admin app = `crm.campusgamingnetwork.com` (post-MVP TanStack Start release).

**Infra:** Railway (Next.js web, Go API, PostgreSQL) · Cloudflare DNS/protection · Resend email (`events@` / `notifications@` / `support@` / `account@`) · curated MVP games (6 titles). Cloudflare R2 for CRM/admin logo uploads is post-MVP.

**MVP excludes:** Sentry/error monitoring, CRM/admin app, clubs, tournaments, on-site payments, usernames, waitlists, team invite links, feature flags, near-you, cancel-event RSVP emails, custom event banner uploads.

**School seed:** import all 6,243 operating schools (4,943 main · 1,300 branch) as `is_active=true`; branch campuses use the same UI/UX; review later in CRM/admin tooling.

## Phase 0 — Foundation

**Goal:** Empty app boots locally and deploys with health checks.

- Docker Compose: Next.js, Go API, Postgres (M1-friendly)
- TypeScript + Go project skeletons; BFF pattern wired
- Untitled UI + base layout; accessibility baseline
- `created_at` / `updated_at` / `deleted_at` conventions
- Health (`/health`, `/ready`)
- System logging vs audit logging distinction established
- CI lint/test stubs
- Railway deploy path for `campusgamingnetwork.com` with web, API, Postgres, migrations, backups, and DNS defined

**Exit:** `docker compose up` works; health green; blank accessible shell page.

**Production deploy decision:** [13 — Deployment plan](./13-deployment-plan.md) locks the main-site MVP onto Railway for the Next.js web service, Go API service, and PostgreSQL database, with Cloudflare for DNS/protection.

## Phase 1 — Auth, profiles, schools (read) — MVP

**Goal:** Users can register and browse schools.

**Detailed plan:** [12 — Phase 1 plan](./12-phase-1-plan.md)

- Signup / login / logout
- Signup sends verification email; link click verifies inbox
- Signup requires **18+** confirmation checkbox
- Forgot / reset password
- Verification levels: email verified → verified student (`.edu`) → staff/faculty
- Profile: single **name** field, bio, social links, timezone, Gravatar with initials fallback; URL `/users/:id`
- Home school selected on signup; follow additional schools afterward
- One-time import of **all** `data/schools_seed.csv` rows as `is_active=true` (`unitid` optional on later admin/CRM creates)
- Public search/browse schools (Postgres `pg_trgm`); school detail by slug (no clubs list until post-MVP)
- Rate limit signups + resend verification (Resend)
- Seed MVP games: Rocket League, Valorant, League of Legends, Overwatch 2, Super Smash Bros. Ultimate, CSGO
- Support email + FAQ + About + Terms + Privacy stubs
- Simple homepage

**Exit:** Logged-out user can search schools; new user verifies email (18+) and can follow a school.

## Phase 2 — Events MVP

**Goal:** Create events, RSVP, email+ICS on the main site.

- Create/edit events; soft delete (no RSVP cancel emails yet); **no approval**
- Slug = `slugify(title)-` + **8** Base64URL chars of SHA-256(creatorId\|createdDate\|title)
- Visibility: public / unlisted / private
- Private: gated/blurred content + password modal (no inspectable details pre-unlock)
- Optional capacity; counts **RSVP yes only**; when full, block yes (**no waitlist**)
- Online/in-person; description limit; **default banner placeholder** (no custom uploads); paid events allowed with off-site payment instructions only
- Location address (+ mini map optional/later)
- Organizers (multi); show creator and hosts
- RSVP yes/no/maybe; separate **interested** favorite
- Registration auto-close; lifecycle UI (upcoming / now / ended / full)
- Browse/filter public events by the six launch games (**no near-you**)
- Confirmation email + ICS on RSVP yes via **Resend**
- Missing/deleted event page
- Rate limit event creation + private unlock attempts
- Audit log writes on event changes
- Support ticket submission from main site (**anyone**, including logged out)

**Exit:** User creates event → another user RSVPs yes → email received with calendar file.

## Phase 3 — Teams + dashboard — MVP

**Goal:** Teams and a useful home dashboard (still no clubs/tournaments).

- Teams: create; **public** pages; password only to join/interact; captains; ownership transfer
- User dashboard: upcoming RSVPs, followed-school activity, team activity
- Report event + report user
- Role indicators for school admin / faculty
- Profanity filter on key text fields (or defer with note)

**Exit:** Student joins a team via password and sees a useful dashboard.

## Phase 4 — CRM/admin app (TanStack Start, post-MVP separate release)

**Goal:** After the main-site MVP, operators manage the catalog without SQL. Deploy to `crm.campusgamingnetwork.com`.

- **TanStack Start** CRM/admin app (not shipped in the main-site MVP)
- Schools: create/edit/soft-delete, logos (**CRM/admin-only** R2 PNG/JPG ≤500 MB), activation, school admins
- Games: manage the curated set; IGDB enrichment later; CRM/admin-only edits
- Users / ACL grants (school admin, staff/faculty)
- **Reports** queue
- **Support tickets** queue
- Site admin bootstrap (CLI / env seed)

**Exit:** Admin can edit a school, grant a school admin, triage a report and a support ticket in CRM.

## Phase 5 — Games enrichment

**Goal:** Expand beyond the six launch titles.

- Broader game catalog / IGDB import via CRM
- Popular games by school
- Events/teams keep game associations

**Exit:** Catalog can grow without user-editable games.

## Phase 6 — Clubs & tournaments (post-MVP)

**Goal:** Official school orgs + competitive layer.

- Clubs: school-scoped; request / approve / manage by school admins; teams (Varsity, JV, …)
- School page lists clubs
- Tournaments as own entity; slug = name + hash; optional event link; optional capacity
- Individual vs team tournaments; captain registration
- Browse/filter tournaments by game

**Exit:** Club on a school page; tournament registerable.

## Phase 7 — Hardening & production ops

**Goal:** Safe to run with real users at scale.

- Nightly DB backups + restore notes
- Sentry/error monitoring
- Broader rate limiting
- Impersonation for site admins (audited)
- Account deletion anonymization path tested
- Past-event edit restrictions enforced
- Recurring events (if not done earlier)
- On-site payments decision (MVP paid events remain off-site-payment listings)
- Event/tournament **waitlists**
- Team **invite links**
- **Near you** / geo discovery
- Cancel-event notify RSVPs
- Feature flags
- Announcements (if still deferred)
- Non-GA analytics
- Accessibility pass; mobile pass
- Performance pass (SSR, code splitting)

**Exit:** Production checklist signed off.

## Later (explicitly not MVP)

- Clubs
- Tournaments
- On-site payments
- Waitlists
- Team invite-link tokens
- Usernames / first+last+display split
- Near you / geo discovery
- Cancel-event notify RSVPs
- Custom event banner uploads (with strict moderation)
- Feature flags
- Impersonation / site announcements (unless pulled into CRM earlier)
- WebSockets / live updates
- Custom avatars
- Friends graph
- Elasticsearch (stay on Postgres search)
- International schools
- Google Maps embed (optional nicety after address works)

## Suggested build order inside a phase

1. Schema + Go domain API
2. BFF + SSR page (main site) or CRM screens
3. Email/side effects
4. Audit/activity writes
5. Rate limits
6. Deploy the app that owns the phase (main vs CRM)
