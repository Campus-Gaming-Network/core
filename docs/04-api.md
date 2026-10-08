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

| Method | Path                        | Notes                                                                                                                                |
| ------ | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| POST   | `/auth/signup`              | Rate limited; requires 18+ confirmation, home school selection, and the [policy claim](#policy-acceptance); sends verification email |
| POST   | `/auth/login`               |                                                                                                                                      |
| POST   | `/auth/logout`              |                                                                                                                                      |
| POST   | `/auth/forgot-password`     |                                                                                                                                      |
| POST   | `/auth/reset-password`      |                                                                                                                                      |
| POST   | `/auth/verify-email`        | Consumes the token after explicit confirmation on the web verification page; direct GET returns 405                                  |
| POST   | `/auth/resend-verification` | Rate limited                                                                                                                         |

### Policy acceptance

| Method | Path                     | Notes                                                                                                   |
| ------ | ------------------------ | ------------------------------------------------------------------------------------------------------- |
| GET    | `/policies/current`      | The Terms and Privacy Policy versions in effect: `version`, `effective_at`, `content_sha256` for each   |
| GET    | `/me/policy-acceptances` | The signed-in user's acceptances, oldest first: `document_type`, `version`, `accepted_at`, and `source` |

`POST /auth/signup` takes `terms_agreed`, `terms_version`, `privacy_acknowledged`,
and `privacy_version`. The person agrees to the Terms and acknowledges the
Privacy Policy; the two are recorded separately. A missing or false flag, or a
missing version, returns `400 invalid_request`. A version that is not the one
in effect (stale or never published) returns `409 policy_version_mismatch`, and
the client shows the current documents again. Both acceptances are written in
the same transaction as the account.

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
| GET    | `/events`                 | Search/browse **public only**, newest start time first; `game`, `school`, `format`, `type`, `audience`, `cost`, `limit`, and opaque `after`/`before` cursors; response includes `has_more` and `has_previous`                                                                 |
| GET    | `/events/:slug`           | Public & unlisted return full page; private returns gated shell until unlocked                                                                                                                                                                                                |
| GET    | `/events/:slug/attendees` | Auth required; the [people list](#people-lists) of RSVPs, `response=yes` (default) or `maybe`; follows the event page's access rules and answers `404 event_not_found` for a missing, cancelled, or still-locked private event                                                |
| POST   | `/events/:slug/unlock`    | Password for private events; unlock session required before details/RSVP                                                                                                                                                                                                      |
| POST   | `/events`                 | Auth; no approval; rate limited; 8-char slug hash; required `event_type` and `audience`; optional capacity; optional off-site payment fields; default banner only; optional `recurrence_rule` (`weekly`, `biweekly`, `monthly`) and `recurrence_until` (`YYYY-MM-DD`)         |
| PATCH  | `/events/:slug`           | Organizers; every field stays editable after the event ends (past-event limits in [07](./07-permissions.md) are planned). Recurrence is set at creation and occurrences are edited independently. Supplying either recurrence field returns `400 event_recurrence_immutable`. |
| DELETE | `/events/:slug`           | Soft-cancel; best-effort email to active yes/maybe RSVPs after cancellation                                                                                                                                                                                                   |
| POST   | `/events/:slug/rsvp`      | yes/no/maybe; capacity counts **yes only**; reject yes if full; email+ICS on yes                                                                                                                                                                                              |
| POST   | `/events/:slug/interest`  | Favorite/bookmark; independent of RSVP                                                                                                                                                                                                                                        |
| DELETE | `/events/:slug/interest`  | Remove favorite                                                                                                                                                                                                                                                               |
| POST   | `/events/:slug/report`    | Rate limited                                                                                                                                                                                                                                                                  |
| GET    | `/events/:slug/audit`     | **(planned)** Event change history                                                                                                                                                                                                                                            |

An event's `event_type` (`game_night`, `lan`, `tournament`, `watch_party`, `tryout`, `meeting`, `workshop`, or `other`) says what kind of event it is. It is required on `POST /events` and `PATCH /events/:slug`; a missing or unknown value returns `400 invalid_request`. Responses include it when set, and events created before the field omit it. `GET /events` filters on it with the `type` query parameter and ignores an unknown value. The `tournament` type is a label only and creates no tournament.

An event's `audience` (`open`, `collegiate`, `campus`, or `members`) says who it is for. It is required on `POST /events` and `PATCH /events/:slug`; a missing or unknown value returns `400 invalid_request`. Responses include it when set, and events created before the field omit it. An unknown `audience` filter on `GET /events` is ignored. Audience is informational: it does not gate the page, RSVPs, or interest. The RSVP confirmation email and its `.ics` description include it.

An event's `cost` is `free`, `paid`, or `unspecified`; it replaces the former `is_paid` boolean. Every event response includes it. `POST /events` and `PATCH /events/:slug` accept it, store a missing value as `unspecified`, and return `400 invalid_request` for an unknown value. `unspecified` means the organizer did not say and is never treated as free. `GET /events?cost=free` returns only events declared free; an unknown `cost` filter is ignored. `payment_note` and `payment_url` are unchanged and describe paid events.

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
| GET    | `/games/:slug/cover`       | Stored cover image of an active game           |
| GET    | `/games/igdb-search?q=`    | Auth; search IGDB from a game picker           |
| GET    | `/games/:slug/events`      | **(planned)** Public events for game + filters |
| GET    | `/games/:slug/tournaments` | **(planned)** Tournaments for game + filters   |

End users cannot edit games. Site admins import and manage them through the
[Admin API](#admin-api), and a signed-in user can add one while creating an
event or team.

`GET /games/igdb-search?q=` (2 to 100 characters) returns
`{ "games": [{ "igdb_id", "name", "release_year"?, "game_id"? }] }`; `game_id`
is set when the catalog already holds the game. Matches whose catalog game a
site admin has hidden or deleted are left out. Results are cached for 24 hours,
so a repeated search does not call IGDB. The route allows 30 searches a minute
per user (`429` `rate_limited`) and answers `503` `igdb_not_configured` without
IGDB credentials and `503` `igdb_unavailable` when IGDB fails. The web app
serves it to the picker at `/api/games/igdb-search`, where a successful result
is cacheable by that browser for five minutes (`private, max-age=300`) and
errors are not cached.

`POST /events`, `PATCH /events/:slug`, and `POST /teams` take two fields beside
`game_ids`. At least one game is required across the three.

- `igdb_game_ids`: up to five IGDB IDs from the search. Each is imported as an
  active game with its cover if the catalog does not hold it. If the cover
  cannot be downloaded or used, the game is imported without it.
- `other_game`: a game name of up to 100 characters. It becomes an unlisted
  game that this event or team uses; the same name typed again reuses it. It
  goes through the blocked-language check.

Games IGDB tags with its "Erotic" theme are treated as if IGDB did not list
them: every search leaves them out, and an import or refresh by ID answers
`igdb_game_not_found`. This applies to the admin routes too.

Nothing is imported until the rest of the request is valid and, for an edit,
the caller is an organizer of the event. A request that names picked or typed
games also counts against the caller's 30-a-minute search limit.

A game a site admin has hidden or deleted is refused with `422`
`game_unavailable`. Other codes: `400` `invalid_game_name`, `422`
`igdb_game_not_found`, `503` `igdb_unavailable`, and `503`
`igdb_not_configured` when `igdb_game_ids` is sent without IGDB credentials.

`GET /games/:slug/cover` returns the image bytes with `Content-Type`, an
`ETag`, `Cache-Control: public, max-age=86400`, and
`X-Content-Type-Options: nosniff`. A matching `If-None-Match` gets `304`. A
game that is hidden, deleted, or has no stored cover gets `404`
`game_cover_not_found`. The web app serves the same bytes to browsers at
`/api/games/:slug/cover`; for a game with a stored cover, `cover_url` in
`GET /games` is that address on `API_SITE_URL`.

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
| IGDB import         | `GET /igdb-games?q=`, `POST /game-imports`, `POST /games/:id/refresh`, and `GET /games/:id/cover`                 |
| Users               | List, get, `suspend`, `reactivate`, `PATCH /users/:id/trust-grants`, and `GET /users/:id/audit`                   |
| Site admins         | `GET`/`POST /site-admin-grants`, `POST /site-admin-grants/:id/revoke`, and `GET /site-admin-grants/:id/audit`     |

The IGDB routes need `games.manage`:

- `GET /igdb-games?q=` searches IGDB by name (2 to 100 characters) and returns
  `{ "games": [{ "igdb_id", "name", "release_year"?, "game_id"? }] }`.
  `game_id` is set when the catalog already holds that IGDB entry. No cover is
  downloaded.
- `POST /game-imports` takes `{ "igdb_id", "reason" }`. The API reads the name,
  slug, and cover from IGDB, creates the game inactive with `igdb_id` and
  `last_synced_at` set, stores the cover, and writes a `game.imported` audit
  row. It returns `201` with the game. A repeat import of the same `igdb_id`
  returns `409` `game_already_imported` with the existing game in `current`.
- `POST /games/:id/refresh` takes `{ "expected_updated_at", "reason" }`. It
  sets `last_synced_at`, replaces the cover only when IGDB's image changed,
  never changes the name or slug, and writes a `game.refreshed` audit row. A
  game that was not imported gets `422` `game_not_from_igdb`.
- `GET /games/:id/cover` returns `{ "content_type", "data" }` with the bytes
  base64-encoded, so the Admin Console can show the cover of a hidden game
  without loading an image from another origin.

Games in admin responses also carry `igdb_id`, `last_synced_at`, `has_cover`,
and `user_submitted`. The admin search shares the 24-hour search cache. IGDB failures use their own codes: `503` `igdb_not_configured`
(no `IGDB_CLIENT_ID` and `IGDB_CLIENT_SECRET` on the API), `503`
`igdb_rate_limited`, `502` `igdb_unavailable`, `404` `igdb_game_not_found`,
`422` `igdb_game_invalid`, and `422` `igdb_cover_unusable` (larger than 100 KB
or not a JPEG, PNG, or WebP). A failed import creates nothing.

Bulk IGDB sync, impersonation, feature flags, and site announcements are later.

### Health

| Method | Path      | Notes           |
| ------ | --------- | --------------- |
| GET    | `/health` | Process up      |
| GET    | `/ready`  | Dependencies up |

### Internal

| Method | Path                              | Notes                                                                                                                                                           |
| ------ | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/internal/schools/refresh`       | Operator-only reload of the in-memory school catalog; bearer `API_MAINTENANCE_TOKEN`; 404 when it is unset                                                      |
| POST   | `/internal/error-monitoring/test` | Operator-only deliberate panic that confirms a deployment reports to Sentry; answers 500 `internal_error`; bearer `API_MAINTENANCE_TOKEN`; 404 when it is unset |

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
- Pagination on every unbounded list endpoint; `GET /games` returns the whole active list

## TanStack usage

- **TanStack Start and TanStack Router** — main site in `apps/web`; the Admin Console in `apps/admin`
  uses the same framework in a separate deployment.
- **TanStack Query / Table / Form** — fine in the Admin Console or selective
  main-site features when a measured need exists.
- Do not add client data libraries by default to routes that work with loaders,
  server functions, and normal HTML forms.
