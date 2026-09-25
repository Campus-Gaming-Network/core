# 04 — API

The public UI talks to a **TanStack Start BFF**; the BFF calls **Go** services
that own domain logic and Postgres. The Admin Console calls the Go Admin API
through its own admin BFF.

## Pattern: Backend for Frontend (BFF)

```text
UI route / server function  →  TanStack Start BFF  →  Go API  →  Postgres
Admin Console screens      →  Admin BFF           →  Go Admin API (/admin/v1)  →  Postgres
```

| Layer              | Responsibility                                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| TanStack Start BFF | Opaque server-side session cookies, CSRF, route-loader data, DTO mapping, server routes, server functions, and native-form redirects |
| Go API             | AuthZ checks, validation, transactions, email triggers, rate limits, and transactional audit writes                                  |
| Browser            | Progressive enhancement only; no core business rules                                                                                 |

Prefer server-rendered routes and server functions over exposing a wide public
JSON surface. Core forms also retain native POST behavior for progressive
enhancement. Where JSON is needed (mobile later, Admin Console, TanStack Query), version
it; the Admin API uses `/admin/v1/...`.

### BFF validation boundaries

The web BFF uses Zod for two trust boundaries:

- Every successful Go API response passed through the client in
  `apps/web/src/server/api.server.ts` is parsed by a feature-local schema in
  `apps/web/src/features/*/contracts.ts`. Frontend DTO types are inferred from
  those schemas so runtime checks and TypeScript cannot drift apart.
- Every mutating server function validates its typed input or normalized
  `FormData` with its feature-local contract before calling Go. Enhanced
  submissions return structured field errors; valid native submissions use
  bounded 303 redirects and remain usable without JavaScript.

Response schemas accept additive unknown fields but validate all fields the web
app consumes. Contract errors record only the endpoint path and schema issues,
never the response payload. Server-only operations live in feature
`*-operations.server.ts` modules, while the shared request, cookie, and visitor
boundary lives under `apps/web/src/server`. Native HTML constraints remain the
first feedback layer and preserve progressive enhancement.

This BFF validation does not move domain ownership out of Go. The API remains
authoritative for authentication, authorization, resource existence and state,
transactions, rate limits, content policy, and persistence validation.

## Cross-cutting API requirements

- **AuthN** — frontend auth uses opaque server-side session cookies (not JWTs); every mutating call validates the session or an explicit non-frontend service credential
- **AuthZ** — enforce roles from [07 — Permissions](./07-permissions.md)
- **Rate limiting** — especially signup, login, verification resend, password reset, `POST /events`, private event unlocks, report endpoints, and `POST /support-tickets`. Anonymous flows are limited per visitor and per target (email address, reset token, or event) across all visitors; see [11 — Implementation decisions](./11-implementation-decisions.md)
- **Idempotency** — consider keys for RSVP and registration emails
- **Health** — `GET /health` (liveness) and `GET /ready` (DB connectivity)
- **Errors** — structured error codes; no stack traces to clients
- **Audit/activity** — administrative changes write `audit_logs` entries in the same transaction as the change; user-facing activity history is later
- **Feature flags** — later; when added, evaluate server-side

## Endpoint surface (v1 intent)

Paths marked **(planned)**, and every path in a section marked (later), are not
implemented yet; align them with [05 — Roadmap](./05-roadmap.md) when they are built.
All other paths exist in the Go API.

### Auth

| Method | Path                        | Notes                                                                                               |
| ------ | --------------------------- | --------------------------------------------------------------------------------------------------- |
| POST   | `/auth/signup`              | Rate limited; requires 18+ confirmation and home school selection; sends verification email         |
| POST   | `/auth/login`               |                                                                                                     |
| POST   | `/auth/logout`              |                                                                                                     |
| POST   | `/auth/forgot-password`     |                                                                                                     |
| POST   | `/auth/reset-password`      |                                                                                                     |
| POST   | `/auth/verify-email`        | Consumes the token after explicit confirmation on the web verification page; direct GET returns 405 |
| POST   | `/auth/resend-verification` | Rate limited                                                                                        |

### Users / profile

| Method | Path                | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------ | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/me`               | Profile + timezone + home school summary + role indicators                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| PATCH  | `/me`               | Name, bio, social links, timezone                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| DELETE | `/me`               | Anonymize the account in place and return 204. Scrubs email, name, bio, and timezone; marks `account_status = 'deleted'`; hard-deletes social links, school follows, RSVPs, interests, notifications, and team/event roles; revokes sessions and drops outstanding tokens and queued email; revokes school-admin and site-admin grants while keeping their history. Teams they own pass to the longest-tenured captain, else the longest-tenured member, else are soft-deleted. Events they created that have not ended pass to the longest-tenured active co-organizer; the rest are archived, and active yes/maybe RSVPs to those that have not ended get a best-effort cancellation email. Returns `409 last_site_admin` when the account is the last active site admin. The scrubbed email releases the original address for re-registration. See [16 — Legal and data-lifecycle plan](./16-legal-and-data-lifecycle-plan.md). |
| GET    | `/me/schools`       | Followed schools                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| GET    | `/me/events`        | Dashboard event sections: upcoming RSVPs + followed-school public events                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| GET    | `/me/teams`         | Dashboard team activity                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| GET    | `/me/activity`      | **(planned)** Full user activity log                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| GET    | `/users/:id`        | Public profile (database id), including `home_school_id`, display-ready `home_school`, verification level, and role indicators when available                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| POST   | `/users/:id/report` | Rate limited                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

### Schools

| Method | Path                         | Notes                                                                                                                        |
| ------ | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/schools`                   | Search/browse (public, incl. logged out); `q`, `state`, `limit`, and `offset`; response includes `has_more` (no total count) |
| GET    | `/schools/:slug`             | Public school page (clubs list when clubs ship)                                                                              |
| POST   | `/schools/:id/follow`        | Auth required                                                                                                                |
| DELETE | `/schools/:id/follow`        |                                                                                                                              |
| GET    | `/schools/:id/games/popular` | **(planned)**                                                                                                                |
| PATCH  | `/schools/:id`               | **(planned)** School admin only; site admins edit schools through the [Admin API](#admin-api)                                |

### Clubs (later)

| Method | Path                          | Notes                                |
| ------ | ----------------------------- | ------------------------------------ |
| GET    | `/schools/:slug/clubs`        | Public; clubs for that school        |
| POST   | `/schools/:id/clubs/requests` | User request                         |
| POST   | `/clubs`                      | School admin create/manage           |
| PATCH  | `/clubs/:id`                  | School admin                         |
| POST   | `/clubs/:id/approve`          | School admin                         |
| POST   | `/clubs/:id/teams`            | Assign team to club (Varsity, JV, …) |

### Teams

| Method | Path                              | Notes                                                                                                                          |
| ------ | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| POST   | `/teams`                          | Anyone authenticated                                                                                                           |
| GET    | `/teams`                          | Public browse; `game`, `school`, `limit`, and opaque `after`/`before` cursors; response includes `has_more` and `has_previous` |
| GET    | `/teams/:slug`                    | **Public** team page                                                                                                           |
| POST   | `/teams/:slug/join`               | Password required to join/interact                                                                                             |
| POST   | `/teams/:slug/transfer-ownership` | Owner                                                                                                                          |
| POST   | `/teams/:slug/captains`           | Assign captains                                                                                                                |
| GET    | `/teams/:slug/audit`              | **(planned)** Team change history                                                                                              |

### Events

| Method | Path                     | Notes                                                                                                                                                                                                                               |
| ------ | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/events`                | Search/browse **public only**, newest start time first; `game`, `school`, `format`, `limit`, and opaque `after`/`before` cursors; response includes `has_more` and `has_previous`                                                   |
| GET    | `/events/:slug`          | Public & unlisted return full page; private returns gated shell until unlocked                                                                                                                                                      |
| POST   | `/events/:slug/unlock`   | Password for private events; unlock session required before details/RSVP                                                                                                                                                            |
| POST   | `/events`                | Auth; no approval; rate limited; 8-char slug hash; optional capacity; optional off-site payment fields; default banner only; optional `recurrence_rule` (`weekly`, `biweekly`, `monthly`) and `recurrence_until` (`YYYY-MM-DD`)     |
| PATCH  | `/events/:slug`          | Organizers; past-event field restrictions; recurrence is configured at creation and occurrences are edited independently (no edit-series workflow yet). Supplying either recurrence field returns `400 event_recurrence_immutable`. |
| DELETE | `/events/:slug`          | Soft-cancel; best-effort email to active yes/maybe RSVPs after cancellation                                                                                                                                                         |
| POST   | `/events/:slug/rsvp`     | yes/no/maybe; capacity counts **yes only**; reject yes if full; email+ICS on yes                                                                                                                                                    |
| POST   | `/events/:slug/interest` | Favorite/bookmark; independent of RSVP                                                                                                                                                                                              |
| DELETE | `/events/:slug/interest` | Remove favorite                                                                                                                                                                                                                     |
| POST   | `/events/:slug/report`   | Rate limited                                                                                                                                                                                                                        |
| GET    | `/events/:slug/audit`    | **(planned)** Event change history                                                                                                                                                                                                  |

Discovery lists only `visibility = public`. Unlisted is link/slug only. Private: do not leak event details in HTML/JSON before unlock — blurred shell + password modal only. Capacity = count of RSVP `yes`; full → cannot RSVP yes (no waitlist). Paid events are allowed only as off-site-payment listings: no checkout, payment intent, refund, tax, payout, or ledger behavior in CGN.

Recurring creation expands into independent event occurrences. The supported
rules are weekly, biweekly, and monthly, with an inclusive end date no more
than one year after the first occurrence. Each occurrence has its own slug,
RSVPs, and cancellation lifecycle. The end date is interpreted through the end
of that calendar day in the selected event timezone.

Occurrence starts retain the first event's local wall-clock time in its IANA
timezone. A start skipped by spring-forward moves ahead by the transition gap;
a repeated fall-back start uses the earlier instant. Every occurrence preserves
the first event's elapsed duration, even when its local end time therefore
changes across a DST boundary. Monthly schedules always calculate from the
original day: they clamp only in months that lack that day and return to it in
the next month that supports it.

The web form accepts local wall-clock values and a curated IANA timezone, then
converts them to offset-bearing timestamps before calling the API. It rejects
nonexistent and ambiguous DST wall times rather than guessing which instant the
user intended for the first event; the recurrence rules above govern derived
occurrences.

Event detail responses include `organizers`, with each organizer's name, role,
`verification_level`, and applicable `role_indicators` (`school_admin` and/or
`staff_faculty`).

### Tournaments (later)

| Method | Path                          | Notes                                               |
| ------ | ----------------------------- | --------------------------------------------------- |
| GET    | `/tournaments`                | Browse/filter by game and other filters             |
| GET    | `/tournaments/:slug`          |                                                     |
| POST   | `/tournaments`                | Slug = name + hash; optional capacity               |
| POST   | `/tournaments/:slug/register` | Individual or team (captain); reject if at capacity |

### Games

| Method | Path                       | Notes                                          |
| ------ | -------------------------- | ---------------------------------------------- |
| GET    | `/games`                   | Browse (public); active games only             |
| GET    | `/games/:slug/events`      | **(planned)** Public events for game + filters |
| GET    | `/games/:slug/tournaments` | **(planned)** Tournaments for game + filters   |

End users cannot edit games; site admins manage them through the
[Admin API](#admin-api). IGDB import is later.

### Notifications & announcements (later)

| Method | Path                         | Notes            |
| ------ | ---------------------------- | ---------------- |
| GET    | `/me/notifications`          |                  |
| POST   | `/me/notifications/:id/read` |                  |
| GET    | `/announcements/active`      | Site-wide banner |

### Support & safety

| Method | Path               | Notes                                                      |
| ------ | ------------------ | ---------------------------------------------------------- |
| POST   | `/support-tickets` | Main site: anyone can submit (logged out OK); rate limited |

Reports are submitted through `POST /events/:slug/report` and
`POST /users/:id/report`.

### Admin API

All routes are under `/admin/v1`. They are served only when `ADMIN_ENABLED` is set, and only to the admin BFF: requests
must carry the admin proxy secret, an Admin Console session, a matching
capability, and CSRF protection on mutations. Request and response contracts,
capabilities, and step-up rules live in
[20 — Admin Console v1 engineering plan](./20-admin-console-v1-engineering-plan.md).

| Area                | Routes                                                                                                            |
| ------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Session             | `POST /auth/exchange`, `POST /auth/step-up`, `GET /session`, `POST /logout`                                       |
| Reports and support | `GET`/`PATCH` `/reports` and `/support-tickets` (list, detail, update) plus `GET …/:id/audit`                     |
| Schools             | List, create, get, update, `deactivate`, `reactivate`, and delete under `/schools`, plus `GET /schools/:id/audit` |
| School admins       | `GET`/`POST /schools/:id/admin-grants`, `POST …/:grant_id/revoke`, and `GET …/:grant_id/audit`                    |
| Games               | List, create, get, update, and delete under `/games`, plus `GET /games/:id/audit`                                 |
| Users               | List, get, `suspend`, `reactivate`, `PATCH /users/:id/trust-grants`, and `GET /users/:id/audit`                   |
| Site admins         | `GET`/`POST /site-admin-grants`, `POST /site-admin-grants/:id/revoke`, and `GET /site-admin-grants/:id/audit`     |

Impersonation, feature flags, and site announcements are later.

### Health

| Method | Path      | Notes           |
| ------ | --------- | --------------- |
| GET    | `/health` | Process up      |
| GET    | `/ready`  | Dependencies up |

### Internal

| Method | Path                        | Notes                                                                                                      |
| ------ | --------------------------- | ---------------------------------------------------------------------------------------------------------- |
| POST   | `/internal/schools/refresh` | Operator-only reload of the in-memory school catalog; bearer `API_MAINTENANCE_TOKEN`; 404 when it is unset |

## Email side effects

| Trigger                                   | Email                                                                                    |
| ----------------------------------------- | ---------------------------------------------------------------------------------------- |
| Event RSVP (yes)                          | Details + ICS — from `events@campusgamingnetwork.com`                                    |
| Event cancellation                        | Active yes/maybe RSVPs; best effort, without ICS — from `events@campusgamingnetwork.com` |
| Signup verification                       | Link — from `account@campusgamingnetwork.com`                                            |
| Password reset                            | Link — from `account@campusgamingnetwork.com`                                            |
| Basic notifications (later)               | From `notifications@campusgamingnetwork.com`                                             |
| Support / report follow-up (later)        | From `support@campusgamingnetwork.com`                                                   |
| (Future) club approval, team invite links | As needed                                                                                |

## Validation & safety

- BFF request and response shapes validated with Zod; Go remains authoritative
  for domain, security, and persistence rules
- Character limits enforced server-side (event description, bio, etc.)
- Basic blocked-language filter on names, bios, event/team text, reports, and
  support messages; reject matches before persistence
- Reject unexpected HTML; store plain text or tightly sanitized markdown (decision TBD)
- Payment fields are display/off-site only; validate any `payment_url` as a safe external URL and make clear users are leaving CGN
- Pagination on all list endpoints

## TanStack usage

- **TanStack Start and TanStack Router** — main site in `apps/web`; the Admin Console in `apps/admin`
  uses the same framework in a separate deployment.
- **TanStack Query / Table / Form** — fine in the Admin Console or selective
  main-site features when a measured need exists.
- Do not add client data libraries by default to routes that work with loaders,
  server functions, and normal HTML forms.
