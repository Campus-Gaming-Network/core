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

- **AuthN** — frontend auth uses opaque server-side session cookies (not JWTs); every mutating call validates the session or an explicit non-frontend service credential. A missing or expired session clears the cookie; a failed session lookup returns `503 session_unavailable` and keeps it
- **AuthZ** — enforce roles from [07 — Permissions](./07-permissions.md)
- **Rate limiting** — signup, login, verification resend, forgot and reset password, `POST /events`, private event unlocks, `POST /teams`, team joins, report endpoints, and `POST /support-tickets`. Anonymous flows are limited per visitor and per target (email address, reset token, or event) across all visitors; see [11 — Implementation decisions](./11-implementation-decisions.md)
- **Idempotency** — `POST /events`, `POST /teams`, `POST /events/:slug/report`, `POST /users/:id/report`, and `POST /support-tickets` require an `Idempotency-Key` UUID header; a missing or malformed key returns `400 invalid_idempotency_key`. Repeating a key returns the record the first request created (`201`) instead of inserting another. A key whose record belongs to a different submitter or target, or was since deleted, returns `409 idempotency_key_reused`. The web app renders one key per form, so double submits and retries after a timeout do not create duplicates. RSVP, interest, follow, and join writes are upserts, and email delivery is deduplicated by `email_outbox.idempotency_key`
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
| GET    | `/me`               | Profile + timezone + home school summary + role indicators + `show_in_lists` (private; never on the public profile)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| PATCH  | `/me`               | Name, bio, social links, timezone, and `show_in_lists` (boolean opt-out from the [people lists](#people-lists)); an absent field is left unchanged and a non-boolean `show_in_lists` returns `400 invalid_json`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| DELETE | `/me`               | Anonymize the account in place and return 204. Scrubs email, name, bio, and timezone; marks `account_status = 'deleted'`; hard-deletes social links, school follows, RSVPs, interests, notifications, and team/event roles; revokes sessions and drops outstanding tokens and queued email; revokes school-admin and site-admin grants while keeping their history. Teams they own pass to the longest-tenured captain, else the longest-tenured member, else are soft-deleted. Events they created that have not ended pass to the longest-tenured active co-organizer; the rest are archived, and active yes/maybe RSVPs to those that have not ended get a best-effort cancellation email. Returns `409 last_site_admin` when the account is the last active site admin. The scrubbed email releases the original address for re-registration. See [16 — Legal and data-lifecycle plan](./16-legal-and-data-lifecycle-plan.md). |
| GET    | `/me/schools`       | Followed schools                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| GET    | `/me/events`        | Dashboard event sections: upcoming RSVPs + followed-school public events                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| GET    | `/me/teams`         | Dashboard team activity                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| GET    | `/me/activity`      | **(planned)** Full user activity log                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| GET    | `/users/:id`        | Public profile (database id), including `home_school_id`, display-ready `home_school`, verification level, and role indicators when available                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| POST   | `/users/:id/report` | Rate limited                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

### Schools

| Method | Path                         | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------ | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/schools`                   | Search/browse (public, incl. logged out); `q`, `state`, `limit`, and `offset`; response includes `has_more` (no total count). `sort=popular` instead returns the most active schools, ranked by active members plus hosted public events (ties: more members, then name), omitting schools with no activity; it takes only `limit` (default 6, at most 50), any other filter or sort returns `400 invalid_sort`, and the ranking is cached for five minutes |
| GET    | `/schools/:slug`             | Public school page (clubs list when clubs ship). School objects include `logo_url` when a logo is set                                                                                                                                                                                                                                                                                                                                                       |
| GET    | `/schools/:slug/members`     | Auth required; the [people list](#people-lists) of users whose home school it is; `404 school_not_found` when missing                                                                                                                                                                                                                                                                                                                                       |
| POST   | `/schools/:id/follow`        | Auth required                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| DELETE | `/schools/:id/follow`        |                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| GET    | `/schools/:id/games/popular` | **(planned)**                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| PATCH  | `/schools/:id`               | **(planned)** School admin only; site admins edit schools through the [Admin API](#admin-api)                                                                                                                                                                                                                                                                                                                                                               |

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

| Method | Path                              | Notes                                                                                                                                            |
| ------ | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| POST   | `/teams`                          | Anyone authenticated                                                                                                                             |
| GET    | `/teams`                          | Public browse; `game`, `school`, `limit`, and opaque `after`/`before` cursors; response includes `has_more` and `has_previous`                   |
| GET    | `/teams/:slug`                    | **Public** team page                                                                                                                             |
| GET    | `/teams/:slug/members`            | Auth required (the team page itself is public); the [people list](#people-lists) of members with their `role`; `404 team_not_found` when missing |
| POST   | `/teams/:slug/join`               | Password required to join/interact                                                                                                               |
| POST   | `/teams/:slug/transfer-ownership` | Owner                                                                                                                                            |
| POST   | `/teams/:slug/captains`           | Assign captains                                                                                                                                  |
| GET    | `/teams/:slug/audit`              | **(planned)** Team change history                                                                                                                |

### Events

| Method | Path                      | Notes                                                                                                                                                                                                                                                                         |
| ------ | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/events`                 | Search/browse **public only**, newest start time first; `game`, `school`, `format`, `limit`, and opaque `after`/`before` cursors; response includes `has_more` and `has_previous`                                                                                             |
| GET    | `/events/:slug`           | Public & unlisted return full page; private returns gated shell until unlocked                                                                                                                                                                                                |
| GET    | `/events/:slug/attendees` | Auth required; the [people list](#people-lists) of RSVPs, `response=yes` (default) or `maybe`; follows the event page's access rules and answers `404 event_not_found` for a missing, cancelled, or still-locked private event                                                |
| POST   | `/events/:slug/unlock`    | Password for private events; unlock session required before details/RSVP                                                                                                                                                                                                      |
| POST   | `/events`                 | Auth; no approval; rate limited; 8-char slug hash; optional capacity; optional off-site payment fields; default banner only; optional `recurrence_rule` (`weekly`, `biweekly`, `monthly`) and `recurrence_until` (`YYYY-MM-DD`)                                               |
| PATCH  | `/events/:slug`           | Organizers; every field stays editable after the event ends (past-event limits in [07](./07-permissions.md) are planned). Recurrence is set at creation and occurrences are edited independently. Supplying either recurrence field returns `400 event_recurrence_immutable`. |
| DELETE | `/events/:slug`           | Soft-cancel; best-effort email to active yes/maybe RSVPs after cancellation                                                                                                                                                                                                   |
| POST   | `/events/:slug/rsvp`      | yes/no/maybe; capacity counts **yes only**; reject yes if full; email+ICS on yes                                                                                                                                                                                              |
| POST   | `/events/:slug/interest`  | Favorite/bookmark; independent of RSVP                                                                                                                                                                                                                                        |
| DELETE | `/events/:slug/interest`  | Remove favorite                                                                                                                                                                                                                                                               |
| POST   | `/events/:slug/report`    | Rate limited                                                                                                                                                                                                                                                                  |
| GET    | `/events/:slug/audit`     | **(planned)** Event change history                                                                                                                                                                                                                                            |

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

### People lists

`GET /events/:slug/attendees`, `GET /schools/:slug/members`, and
`GET /teams/:slug/members` return one shape. Who appears, and why, is a product
rule owned by [01 — Product](./01-product.md#people-lists); who may read the
lists is in [07 — Permissions](./07-permissions.md#people-list-rules).

Request:

- A session is required. A signed-out request returns `401 authentication_required`
  and any method but `GET` returns `405`.
- `limit` is 1–100 and defaults to 25; anything else returns `400 invalid_limit`.
- `after` and `before` are opaque cursors from a previous response. At most one may
  be sent. A malformed cursor, both cursors, or a cursor from a different kind of
  list (such as an event list's) returns `400 invalid_cursor`.
- Attendees also take `response`, `yes` (the default) or `maybe`. Any other value,
  including an empty one, returns `400 invalid_response`.
- The attendee list uses the event page's access rule: an organizer, or a viewer
  whose `X-CGN-Event-Unlock` token is valid, may read a private event's list. For
  anyone else the answer is `404 event_not_found`, identical to a missing or
  cancelled event.

Response:

```json
{
  "people": [
    {
      "id": "uuid",
      "name": "Ada Lovelace",
      "verification_level": "verified",
      "role_indicators": ["school_admin"],
      "role": "captain"
    }
  ],
  "limit": 25,
  "has_more": true,
  "has_previous": false,
  "next_cursor": "opaque",
  "previous_cursor": "opaque"
}
```

- `role_indicators` is omitted when empty. `role` (`owner`, `captain`, or
  `member`) appears only in team lists. `next_cursor` and `previous_cursor` are
  omitted when there is no such page. A row carries no other account field.
- Order is case-insensitive name, then id. Team lists order the owner first, then
  captains, then members, each by name. A cursor carries its row's sort key
  rather than pointing at the row, so paging still works after that person opts
  out or leaves.
- `verification_level` and `role_indicators` mean what they do on the public
  profile.
- Responses carry `Cache-Control: private, no-store` and
  `Vary: Cookie, Authorization` (attendees also vary on `X-CGN-Event-Unlock`).
- The owner-only `members` roster inside `GET /teams/:slug` is a different list,
  used for captain management. It still lists every active member and is not
  affected by `show_in_lists`.

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
must carry the admin proxy secret exactly once, an Admin Console session, the
Access identity the BFF verified for the request (`X-CGN-Admin-Access-Email`,
which must match the identity the session was issued to), a matching capability,
and CSRF protection on mutations. Request and response contracts,
capabilities, and step-up rules live in
[20 — Admin Console v1 engineering plan](./20-admin-console-v1-engineering-plan.md).

| Area                | Routes                                                                                                            |
| ------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Session             | `POST /auth/exchange`, `POST /auth/step-up`, `GET /session`, `POST /logout`                                       |
| Reports and support | `GET`/`PATCH` `/reports` and `/support-tickets` (list, detail, update) plus `GET …/:id/audit`                     |
| Queue counts        | `GET /report-counts` and `GET /support-ticket-counts`                                                             |
| Schools             | List, create, get, update, `deactivate`, `reactivate`, and delete under `/schools`, plus `GET /schools/:id/audit` |
| School logos        | `POST /schools/:id/logo` (multipart upload) and `DELETE /schools/:id/logo`                                        |
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
- Pagination on every unbounded list endpoint; `GET /games` returns the whole curated active list

## TanStack usage

- **TanStack Start and TanStack Router** — main site in `apps/web`; the Admin Console in `apps/admin`
  uses the same framework in a separate deployment.
- **TanStack Query / Table / Form** — fine in the Admin Console or selective
  main-site features when a measured need exists.
- Do not add client data libraries by default to routes that work with loaders,
  server functions, and normal HTML forms.
