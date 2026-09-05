# 10 — Delivery status

Status tracker for Campus Gaming Network. Locked product decisions live in the other docs (`01`, `05`, `08`) — not repeated here.

Work is grouped **Now** (building toward the first public release), **Next** (planned immediately after), and **Later** (planned, not yet scheduled). Nothing here is written off — Later means "not scheduled yet", not "out of scope".

**Current focus:** continue feature development, product refinement, regression coverage, and production-readiness hardening. Deployment and external environment setup are intentionally deferred until the product plan is refreshed.

**Active milestone:** make the existing events-and-teams product polished and reliable enough for real users.

**Priority order:**

1. Quality pass on current user journeys: signup, event creation, RSVP, team joining, and dashboard.
2. Lightweight moderation and operations: reports/support queue, deactivation tools, audit history, and notifications.
3. Expand trust and safety beyond the first role and content-filtering pass.
4. Production-readiness hardening: monitoring, legal content, performance, and launch checks.
5. Clubs and tournaments after the current event loop has been validated with real users.

**First release slice:** auth → home school on signup → schools search/follow → events + curated games → teams → dashboard.

**School seed:** 6,243 operating schools (4,943 main · **1,300 branch**). Import all, `is_active=true`; branch campuses use the same UI/UX; review later in CRM/admin tooling.

**Launch games:** Rocket League · Valorant · League of Legends · Overwatch 2 · Super Smash Bros. Ultimate · CSGO.

---

## Decided before coding

No blocking decisions left for media/slugs/email. Optional later: exact default banner asset design.

| Topic | Decision |
|-------|----------|
| Event slug hash | **8** Base64URL chars |
| Images | **PNG or JPG only**; max **500 MB** |
| Event banners | Default placeholder image/background — **no user uploads yet** |
| School logos | Placeholder for now; CRM/admin upload via R2 later |
| Email From | Now: `events@` / `account@`; later workflows: `notifications@` / `support@campusgamingnetwork.com` |
| Paid events | Off-site-payment listings only; no CGN checkout/payments |
| Deploy path | Railway hosts Next.js, Go API, and PostgreSQL; Cloudflare manages DNS/protection |

---

## Now — first public release

### Foundation
- [x] Docker Compose: Next.js, Go API, Postgres (M1-friendly)
- [x] Project skeletons + BFF wiring
- [x] Health checks
- [x] Resend wired for transactional email
- [x] Deploy path selected: Railway for web, API, and Postgres
- [x] Add Railway web/API/seed config, production Docker builds, migration pre-deploy, health checks, and smoke script
- [ ] Provision Railway staging/production + DNS + backups and execute the documented launch/smoke-test flow

### Pre-launch polish
- [x] Dependency and advisory sweep: Go 1.25 with current `pgx`/`golang.org/x/*`, Next.js 16.3 clearing 9 high-severity advisories plus transitive `postcss`/`sharp`, oxlint 1.77
- [x] Go toolchain refresh: Go 1.27.1 for the API module, CI, Docker build, and local formatting; API runtime image on Alpine 3.24
- [x] Per-page metadata and social tags, with `noindex` on authenticated, token, private, and unlisted routes
- [x] Error, loading, and not-found boundaries; browse pages in `(browse)` route groups so missing entities still return 404
- [x] Transactional email failures no longer fail the committed write behind them (RSVP, signup, password reset)
- [x] Argon2id password hashing with parameters stored per hash
- [x] Account deletion and anonymization via `DELETE /me`, with team ownership succession
- [x] Bounded rate-limiter memory and an hourly sweeper for expired sessions, tokens, and event unlocks
- [x] Panic recovery middleware, HTTP server timeouts, configurable database pool ceiling
- [x] School catalog served from memory with HTTP caching; dead trigram indexes dropped (search 9.4 ms → 1.0 ms)
- [x] Operations foundation: assignable report/support queues with retention clocks, transactional audit history, user-scoped notifications, and PostgreSQL-backed CI tests
- [x] Account deletion transfers future events to an active co-organizer or archives them, archives orphan/past events and their child records, detaches support cases, scrubs terminal contact fields, removes personal notifications/roles, and unassigns operations queues
- [ ] Notify active yes/maybe attendees when account deletion archives an orphaned future event
- [ ] Replace placeholder Terms/Privacy, obtain legal review, and require versioned Terms agreement/Privacy acknowledgement at signup
- [ ] Confirm retention windows and legal-hold ownership; document the manual retention runbook before enabling purge automation
- [ ] Decide and implement Gravatar disclosure/opt-out defaults
- [ ] Resolve `.edu` verified-student assignment and trusted forwarded-IP rate limiting

### Auth & profiles
- [x] Signup / login / logout
- [x] Signup requires selecting a home school
- [x] Verification email + resend (rate limited)
- [x] 18+ checkbox (store timestamp)
- [x] Forgot / reset password
- [x] Profile: single **name** field, bio, socials, timezone
- [x] Gravatar with initials fallback
- [x] Public profile at `/users/:id` (database id)

### Schools
- [x] One-time import of **all** seed schools as `is_active=true` (main + branch; same UI/UX)
- [x] Public search/browse (Postgres), including logged out
- [x] School detail by slug
- [x] Follow / unfollow school
- [x] Empty states for school list + school page

### Games (curated seed)
- [x] Seed/curate launch games:
  - Rocket League
  - Valorant
  - League of Legends
  - Overwatch 2
  - Super Smash Bros. Ultimate
  - CSGO
- [x] Browse/filter events by these games
- [x] End users cannot edit games (admin seed; CRM later)

### Events
- [x] Create / edit / soft-cancel (no approval; cancellation email to active yes/maybe RSVPs)
- [x] Slug = `slugify(title) + "-" + base64url(sha256(...))` (**8** chars)
- [x] Visibility: public / unlisted / private
- [x] Private: content fully gated (not inspectable); password form to unlock
- [x] Optional capacity (count **RSVP yes** only)
- [x] Paid event toggle + off-site payment note/link only (no CGN payment processing)
- [x] RSVP yes/no/maybe
- [x] RSVP confirmation email + ICS on yes (Resend)
- [x] Interested (favorite) separate from RSVP
- [x] Browse/filter public events by game (no near-you yet)
- [x] Lifecycle UI: upcoming / happening now / ended / full
- [x] Missing/deleted event page
- [x] Rate limit event create + private unlock attempts
- [x] Default event banner/background placeholder (no custom uploads yet)
- [x] Recurring events (weekly, biweekly, or monthly; max one year; independent occurrences)
- [x] Cancellation notifications to active yes/maybe RSVPs (best-effort email)
- [x] Empty states for events browse

### Teams
- [x] Create team
- [x] **Public** team page
- [x] Password only required to **join / interact**
- [x] Captains + ownership transfer
- [x] Dashboard shows team activity

### Dashboard & content
- [x] Simple dashboard: upcoming RSVPs + followed-school events + team activity
- [x] Homepage (works with little/no UGC)
- [x] Cold-start plan (demo seed and/or “create first event” CTA)
- [x] FAQ and About; Terms and Privacy routes exist pending reviewed copy
- [x] Support ticket form — **anyone** can submit (logged out OK)

### Safety (baseline)
- [x] Rate limits: signup, resend verification, event create, reports, private unlock, support tickets
- [x] Report event + report user (queued for CRM/admin review)
- [x] New-account abuse limits (basic)

---

## Next — immediately after the first release

### CRM/admin app (`crm.campusgamingnetwork.com` — TanStack Start)
- [x] Add operations data/repository foundation for assignable reports/support queues with terminal retention clocks, transactional audit history, and user-scoped notifications
- [ ] Bootstrap first site admin (CLI / env seed)
- [ ] Add site-admin-authorized reports, support, and audit API endpoints
- [ ] TanStack Start CRM app (separate deploy, shared Go API)
- [ ] Schools: create / edit / soft-delete, logos (**CRM/admin-only** R2 PNG/JPG ≤500 MB), activation (`unitid` optional)
- [ ] Review/deactivate bad seed schools
- [ ] Manage/grant school admins in CRM (grant storage and indicators implemented)
- [ ] Games catalog management (start from the six launch games; IGDB later)
- [ ] Reports queue
- [ ] Support tickets queue
- [ ] User notification API and in-app inbox
- [ ] Placeholder school logos until CRM upload

### Product polish
- [ ] Sentry/error monitoring
- [ ] Analytics (non-GA: Plausible or Cloudflare Web Analytics)
- [x] Define and apply basic blocked-language filtering
- [ ] Frontend regression test coverage for pages, components, and server actions
- [ ] Open Graph share image, favicon, `robots.txt`, and `sitemap.xml`

### Active product milestone
- [x] Complete frontend regression coverage for signup, event creation, RSVP, team joining, and dashboard flows
- [ ] Complete mobile and accessibility pass on the primary journeys
- [x] Define initial support/report/audit retention targets and track legal-hold/purge follow-up
- [x] Transfer or soft-cancel organizer-owned events during account deletion; detach support records and scrub terminal contact fields
- [x] Add recurring events (weekly, biweekly, or monthly; max one year)
- [x] Add cancellation notifications to active yes/maybe RSVPs
- [x] Improve event discovery filters (game, school, and format)
- [x] Add `.edu` verified-student badge UX
- [x] Add school admin/faculty role indicators
- [x] Add event organizer badges
- [x] Define and apply basic blocked-language filtering

---

## Later — planned, not yet scheduled

### Near-term candidates
- [ ] Google Maps embed (address text is enough first)
- [ ] Richer profile fields (majors, graduation automation, faculty extras)
- [x] Database-backed audit-history foundation (broader domain adoption and UIs remain)
- [ ] User-visible activity history and notification inbox
- [ ] Site-wide announcements
- [ ] Impersonation
- [ ] Broader IGDB game import

### Larger feature areas
- [ ] Clubs
- [ ] Tournaments
- [ ] On-site payments
- [ ] Waitlists
- [ ] Team invite-link tokens
- [ ] Usernames / first+last+display split
- [ ] Feature flags
- [ ] **Near you** / geo discovery
- [ ] **Custom event banner uploads** (with strict moderation)
- [ ] Friends graph
- [ ] WebSockets / live updates
- [ ] Custom avatars
- [ ] Elasticsearch
- [ ] International schools

---

## Suggested order

1. Foundation + auth + schools + **six launch games**
2. Events (default banners) + teams + dashboard + legal/support
3. CRM/admin app (TanStack Start), separate release — school logos
4. Work down the Later list by value
