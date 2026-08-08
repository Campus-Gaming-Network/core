# 04 — API

Public UI talks to a **Next.js BFF**; the BFF calls **Go** services that own domain logic and Postgres. The later CRM app also calls Go (directly or via an admin BFF).

## Pattern: Backend for Frontend (BFF)

```text
UI route / Server Action  →  Next.js BFF  →  Go API  →  Postgres
Later CRM screens      →  (CRM BFF or direct) →  Go Admin API  →  Postgres
```

| Layer | Responsibility |
|-------|----------------|
| Next.js BFF | Opaque server-side session cookies, CSRF, aggregating page props, mapping DTOs to UI, route handlers / server actions |
| Go API | AuthZ checks, validation, transactions, email triggers, rate limits, and future audit writes |
| Browser | Progressive enhancement only; no core business rules |

Prefer server-rendered pages and server actions over exposing a wide public JSON surface. Where JSON is needed (mobile later, CRM, TanStack Query), version it (`/api/v1/...`).

## Cross-cutting API requirements

- **AuthN** — frontend auth uses opaque server-side session cookies (not JWTs); every mutating call validates the session or an explicit non-frontend service credential
- **AuthZ** — enforce roles from [07 — Permissions](./07-permissions.md)
- **Rate limiting** — especially `POST /auth/signup`, `POST /auth/resend-verification`, `POST /events`, private event unlocks, report endpoints, and `POST /support-tickets`
- **Idempotency** — consider keys for RSVP and registration emails
- **Health** — `GET /health` (liveness) and `GET /ready` (DB connectivity)
- **Errors** — structured error codes; no stack traces to clients
- **Audit/activity** — later; keep operational logs now, then add database-backed domain history as its own slice
- **Feature flags** — later; when added, evaluate server-side

## Endpoint surface (v1 intent)

Not every path must exist on day one — align with [05 — Roadmap](./05-roadmap.md). Names are indicative.

### Auth

| Method | Path | Notes |
|--------|------|-------|
| POST | `/auth/signup` | Rate limited; requires 18+ confirmation and home school selection; sends verification email |
| POST | `/auth/login` | |
| POST | `/auth/logout` | |
| POST | `/auth/forgot-password` | |
| POST | `/auth/reset-password` | |
| GET/POST | `/auth/verify-email` | Click link from verification email |
| POST | `/auth/resend-verification` | Rate limited |

### Users / profile

| Method | Path | Notes |
|--------|------|-------|
| GET | `/me` | Profile + timezone + home school summary + role indicators |
| PATCH | `/me` | Name, bio, socials, timezone, majors, graduation |
| DELETE | `/me` | Anonymize the account in place and return 204. Scrubs email, name, bio, and timezone; marks `account_status = 'deleted'`; hard-deletes social links, school follows, RSVPs, and interests; revokes sessions and drops outstanding tokens. Teams they own pass to the longest-tenured captain, else the longest-tenured member, else are soft-deleted. Events they created stay published; the deleted organizer is omitted from public organizer summaries. The scrubbed email releases the original address for re-registration. |
| GET | `/me/schools` | Followed schools |
| GET | `/me/events` | Dashboard event sections: upcoming RSVPs + followed-school public events |
| GET | `/me/teams` | Dashboard team activity |
| GET | `/me/activity` | Future full user activity log |
| GET | `/users/:id` | Public profile (database id), including `home_school_id`, display-ready `home_school`, verification level, and role indicators when available |
| POST | `/users/:id/report` | Rate limited |

### Schools

| Method | Path | Notes |
|--------|------|-------|
| GET | `/schools` | Search/browse (public, incl. logged out); `q`, state, sort |
| GET | `/schools/:slug` | Public school page (clubs list when clubs ship) |
| POST | `/schools/:id/follow` | Auth required |
| DELETE | `/schools/:id/follow` | |
| GET | `/schools/:id/games/popular` | |
| PATCH | `/schools/:id` | School admin only |
| POST | `/admin/schools` | Later site admin / CRM-admin only |

### Clubs (later)

| Method | Path | Notes |
|--------|------|-------|
| GET | `/schools/:slug/clubs` | Public; clubs for that school |
| POST | `/schools/:id/clubs/requests` | User request |
| POST | `/clubs` | School admin create/manage |
| PATCH | `/clubs/:id` | School admin |
| POST | `/clubs/:id/approve` | School admin |
| POST | `/clubs/:id/teams` | Assign team to club (Varsity, JV, …) |

### Teams

| Method | Path | Notes |
|--------|------|-------|
| POST | `/teams` | Anyone authenticated |
| GET | `/teams/:slug` | **Public** team page |
| POST | `/teams/:slug/join` | Password required to join/interact |
| POST | `/teams/:slug/transfer-ownership` | Owner |
| POST | `/teams/:slug/captains` | Assign captains |
| GET | `/teams/:slug/audit` | Later team change history |

### Events

| Method | Path | Notes |
|--------|------|-------|
| GET | `/events` | Search/browse **public only**; filters: game, school, format, … (no near-you yet) |
| GET | `/events/:slug` | Public & unlisted return full page; private returns gated shell until unlocked |
| POST | `/events/:slug/unlock` | Password for private events; unlock session required before details/RSVP |
| POST | `/events` | Auth; no approval; rate limited; 8-char slug hash; optional capacity; optional off-site payment fields; default banner only; optional `recurrence_rule` (`weekly`, `biweekly`, `monthly`) and `recurrence_until` (`YYYY-MM-DD`) |
| PATCH | `/events/:slug` | Organizers; past-event field restrictions; recurrence is configured at creation and occurrences are edited independently (no edit-series workflow yet) |
| DELETE | `/events/:slug` | Soft-cancel; best-effort email to active yes/maybe RSVPs after cancellation |
| POST | `/events/:slug/rsvp` | yes/no/maybe; capacity counts **yes only**; reject yes if full; email+ICS on yes |
| POST | `/events/:slug/interest` | Favorite/bookmark; independent of RSVP |
| DELETE | `/events/:slug/interest` | Remove favorite |
| POST | `/events/:slug/report` | Rate limited |
| GET | `/events/:slug/audit` | Later event change history |

Discovery lists only `visibility = public`. Unlisted is link/slug only. Private: do not leak event details in HTML/JSON before unlock — blurred shell + password modal only. Capacity = count of RSVP `yes`; full → cannot RSVP yes (no waitlist). Paid events are allowed only as off-site-payment listings: no checkout, payment intent, refund, tax, payout, or ledger behavior in CGN.

Recurring creation expands into independent event occurrences. The supported
rules are weekly, biweekly, and monthly, with an inclusive end date no more
than one year after the first occurrence. Each occurrence has its own slug,
RSVPs, and cancellation lifecycle.

Event detail responses include `organizers`, with each organizer's name, role,
and applicable `role_indicators` (`school_admin` and/or `staff_faculty`).

### Tournaments (later)

| Method | Path | Notes |
|--------|------|-------|
| GET | `/tournaments` | Browse/filter by game and other filters |
| GET | `/tournaments/:slug` | |
| POST | `/tournaments` | Slug = name + hash; optional capacity |
| POST | `/tournaments/:slug/register` | Individual or team (captain); reject if at capacity |

### Games

| Method | Path | Notes |
|--------|------|-------|
| GET | `/games` | Browse (public); currently the 6 curated launch games |
| GET | `/games/:slug/events` | Public events for game + filters |
| GET | `/games/:slug/tournaments` | Tournaments for game + filters (later) |
| POST | `/admin/games/sync` | IGDB import (later; CRM / cron) |
| PATCH | `/admin/games/:id` | Later CRM/admin only — end users cannot edit games |

### Notifications & announcements (later)

| Method | Path | Notes |
|--------|------|-------|
| GET | `/me/notifications` | |
| POST | `/me/notifications/:id/read` | |
| GET | `/announcements/active` | Site-wide banner |

### Moderation & admin (CRM, later — crm.campusgamingnetwork.com)

| Method | Path | Notes |
|--------|------|-------|
| POST | `/support-tickets` | Main site: anyone can submit (logged out OK); rate limited |
| GET | `/admin/reports` | All reports |
| PATCH | `/admin/reports/:id` | |
| GET | `/admin/support-tickets` | Support tickets from main site |
| PATCH | `/admin/support-tickets/:id` | |
| POST | `/admin/impersonate` | Site admin; heavily audited (later) |
| POST | `/admin/impersonate/stop` | |
| CRUD | `/admin/feature-flags` | Later |
| CRUD | `/admin/users` | ACL management |
| CRUD | `/admin/announcements` | Later |

### Health

| Method | Path | Notes |
|--------|------|-------|
| GET | `/health` | Process up |
| GET | `/ready` | Dependencies up |

## Email side effects

| Trigger | Email |
|---------|-------|
| Event RSVP (yes) | Details + ICS — from `events@campusgamingnetwork.com` |
| Event cancellation | Active yes/maybe RSVPs; best effort, without ICS — from `events@campusgamingnetwork.com` |
| Signup verification | Link — from `account@campusgamingnetwork.com` |
| Password reset | Link — from `account@campusgamingnetwork.com` |
| Basic notifications (later) | From `notifications@campusgamingnetwork.com` |
| Support / report follow-up (later) | From `support@campusgamingnetwork.com` |
| (Future) club approval, team invite links | As needed |

## Validation & safety

- Character limits enforced server-side (event description, bio, etc.)
- Basic blocked-language filter on names, bios, event/team text, reports, and
  support messages; reject matches before persistence
- Reject unexpected HTML; store plain text or tightly sanitized markdown (decision TBD)
- Payment fields are display/off-site only; validate any `payment_url` as a safe external URL and make clear users are leaving CGN
- Pagination on all list endpoints

## TanStack usage

- **TanStack Start** — later CRM app (`crm.campusgamingnetwork.com`)
- **TanStack Query / Table / Form** — fine in later CRM and selective main-site islands
- Do not add TanStack by default to main-site SSR pages that work with server props
