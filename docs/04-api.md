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
| PATCH  | `/me`               | Name, bio, [social links](#social-links), timezone, and `show_in_lists` (boolean opt-out from the [people lists](#people-lists)); an absent field is left unchanged and a non-boolean `show_in_lists` returns `400 invalid_json`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| DELETE | `/me`               | Anonymize the account in place and return 204. Scrubs email, name, bio, and timezone; marks `account_status = 'deleted'`; hard-deletes social links, school follows, RSVPs, interests, notifications, and team/event roles; revokes sessions and drops outstanding tokens and queued email; revokes school-admin and site-admin grants while keeping their history. Teams they own pass to the longest-tenured captain, else the longest-tenured member, else are soft-deleted. Events they created that have not ended pass to the longest-tenured active co-organizer; the rest are archived, and active yes/maybe RSVPs to those that have not ended get a best-effort cancellation email. Returns `409 last_site_admin` when the account is the last active site admin. The scrubbed email releases the original address for re-registration. See [16 — Legal and data-lifecycle plan](./16-legal-and-data-lifecycle-plan.md). |
| GET    | `/me/schools`       | Followed schools                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| GET    | `/me/events`        | Dashboard event sections: upcoming RSVPs, upcoming events the caller marked "interested" (`interested_events`, soonest first), and followed-school public events                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| GET    | `/me/teams`         | Dashboard team activity                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| GET    | `/me/activity`      | **(planned)** Full user activity log                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| GET    | `/users/:id`        | Public profile (database id), including `home_school_id`, display-ready `home_school`, [social links](#social-links), verification level, and role indicators when available                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| POST   | `/users/:id/report` | Rate limited                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

#### Social links

`social_links` is an ordered list of up to 8 links. When `PATCH /me` includes
it, it replaces the whole list. Each link has a `kind`:

| `kind`    | Fields              | Rules                                                                                                                                                                                                              |
| --------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `url`     | `label`, `url`      | `label` is required, up to 40 characters. `url` is an HTTP or HTTPS URL, up to 500 characters. A link sent without a `kind` is a `url` link                                                                        |
| `discord` | `label`, `username` | `username` is a Discord username: 2 to 32 characters from `a-z`, `0-9`, `_`, and `.`, with no two periods in a row. The API removes a leading `@` and lowercases it. `label` is always `Discord`, whatever is sent |

A `url` link has no `username` and a `discord` link has no `url`; sending the
other field, an unknown `kind`, or a value that breaks a rule returns
`400 invalid_request`. Responses always include `kind`. The web account form
offers three `url` links and one Discord username, and the public profile shows
a Discord link as text because a username has no page to link to.

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

| Method | Path                      | Notes                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------ | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/events`                 | Search/browse **public only**, events under way or upcoming, soonest start time first (ended events are left out); `game`, `school`, `format`, `type`, `audience`, `cost`, `starts_after` and `starts_before` (RFC 3339; at or after, and before; an empty or malformed range is `invalid_time_range`), `limit`, and opaque `after`/`before` cursors; response includes `has_more` and `has_previous` |
| GET    | `/events/:slug`           | Public & unlisted return full page; private returns gated shell until unlocked                                                                                                                                                                                                                                                                                                                        |
| GET    | `/events/:slug/attendees` | Auth required; the [people list](#people-lists) of RSVPs, `response=yes` (default) or `maybe`; follows the event page's access rules and answers `404 event_not_found` for a missing, cancelled, or still-locked private event                                                                                                                                                                        |
| POST   | `/events/:slug/unlock`    | Password for private events; unlock session required before details/RSVP                                                                                                                                                                                                                                                                                                                              |
| POST   | `/events`                 | Auth; no approval; rate limited; 8-char slug hash; required `event_type` and `audience`; optional capacity; optional off-site payment fields; default banner only; optional `recurrence_rule` (`weekly`, `biweekly`, `monthly`) and `recurrence_until` (`YYYY-MM-DD`)                                                                                                                                 |
| PATCH  | `/events/:slug`           | Organizers; every field stays editable after the event ends (past-event limits in [07](./07-permissions.md) are planned). Recurrence is set at creation and occurrences are edited independently. Supplying either recurrence field returns `400 event_recurrence_immutable`.                                                                                                                         |
| DELETE | `/events/:slug`           | Soft-cancel; best-effort email to active yes/maybe RSVPs after cancellation                                                                                                                                                                                                                                                                                                                           |
| POST   | `/events/:slug/rsvp`      | yes/no/maybe; capacity counts **yes only**; reject yes if full; email+ICS on yes, with the start time shown in the event's time zone                                                                                                                                                                                                                                                                  |
| POST   | `/events/:slug/interest`  | Favorite/bookmark; independent of RSVP                                                                                                                                                                                                                                                                                                                                                                |
| DELETE | `/events/:slug/interest`  | Remove favorite                                                                                                                                                                                                                                                                                                                                                                                       |
| POST   | `/events/:slug/report`    | Rate limited                                                                                                                                                                                                                                                                                                                                                                                          |
| GET    | `/events/:slug/audit`     | **(planned)** Event change history                                                                                                                                                                                                                                                                                                                                                                    |

An event's `event_type` (`game_night`, `lan`, `tournament`, `watch_party`, `tryout`, `meeting`, `workshop`, or `other`) says what kind of event it is. It is required on `POST /events` and `PATCH /events/:slug`; a missing or unknown value returns `400 invalid_request`. Responses include it when set, and events created before the field omit it. `GET /events` filters on it with the `type` query parameter and ignores an unknown value. The `tournament` type is a label only and creates no tournament.

An event's `audience` (`open`, `collegiate`, `campus`, or `members`) says who it is for. It is required on `POST /events` and `PATCH /events/:slug`; a missing or unknown value returns `400 invalid_request`. Responses include it when set, and events created before the field omit it. An unknown `audience` filter on `GET /events` is ignored. Audience is informational: it does not gate the page, RSVPs, or interest. The RSVP confirmation email and its `.ics` description include it.

An event's `cost` is `free`, `paid`, or `unspecified`; it replaces the former `is_paid` boolean. Every event response includes it. `POST /events` and `PATCH /events/:slug` accept it, store a missing value as `unspecified`, and return `400 invalid_request` for an unknown value. `unspecified` means the organizer did not say and is never treated as free. `GET /events?cost=free` returns only events declared free; an unknown `cost` filter is ignored. `payment_note` and `payment_url` are unchanged and describe paid events.

An event's `online_url` is sent only to a requester whose RSVP is `yes` or who organizes the event; everyone else receives the event without it, and `GET /events` never includes it. See [07 — Permissions](./07-permissions.md#event-rules).

Each entry in an event's `games` is `{ "id", "name", "slug", "has_cover" }`. `has_cover` is true when the site serves the game's cover at `/api/games/:slug/cover`, so it is false for a game with no stored cover and for one a site admin has hidden since the event chose it.

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
`verification_level`, and applicable `role_indicators`, in this order:
`school_admin` (an active school-admin grant), `site_admin` (an active
site-admin grant), and `staff_faculty`. Profiles and people lists carry the
same indicators.

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

| Method | Path                       | Notes                                                    |
| ------ | -------------------------- | -------------------------------------------------------- |
| GET    | `/games`                   | Browse (public); active games only; `q` searches by name |
| GET    | `/games/:slug`             | One active game (public); `404 game_not_found` otherwise |
| GET    | `/games/:slug/cover`       | Stored cover image of an active game                     |
| GET    | `/games/igdb-search?q=`    | Auth; search IGDB from a game picker                     |
| GET    | `/igdb-covers/:image_id`   | Small IGDB cover of a recent search result (public)      |
| GET    | `/games/:slug/events`      | **(planned)** Public events for game + filters           |
| GET    | `/games/:slug/tournaments` | **(planned)** Tournaments for game + filters             |

End users cannot edit games. A signed-in user can add one while creating an
event or team, and site admins correct, hide, delete, and refresh games through
the [Admin API](#admin-api); admins do not add games.

`GET /games` with no `q` returns every active game by name, as
`{ "games": [{ "id", "name", "slug", "cover_url"? }] }`. With `q` (1 to 100
characters after trimming, else `400 invalid_game_query`) it returns at most
`limit` (default 20, 1 to 50, else `400 invalid_limit`) active games whose
name contains `q`, ignoring case and matching `%` and `_` literally: an exact
name first, then names that start with `q`, then the rest, each by name. The
directories' game filters use the search and `GET /games/:slug`, which returns
one game in the same shape, so they never load the whole catalog. The web app
serves the filter's search to browsers at `/api/games/catalog-search?q=`.

`GET /games/igdb-search?q=` (2 to 100 characters) returns
`{ "games": [{ "igdb_id", "name", "release_year"?, "game_id"?, "slug"?, "has_cover"?, "cover_image_id"? }] }`; `game_id`
is set when the catalog already holds the game, with its `slug` and `has_cover`
so a picker can show `/api/games/{slug}/cover`. `cover_image_id` names IGDB's
cover when IGDB has one. Matches whose catalog game a
site admin has hidden or deleted are left out. Results are cached for 24 hours,
so a repeated search does not call IGDB. The route allows 30 searches a minute
per user (`429` `rate_limited`) and answers `503` `igdb_not_configured` without
IGDB credentials and `503` `igdb_unavailable` when IGDB fails. The web app
serves it to the picker at `/api/games/igdb-search`, where a successful result
is cacheable by that browser for five minutes (`private, max-age=300`) and
errors are not cached.

`GET /igdb-covers/:image_id` serves IGDB's small (90×128) cover for a
`cover_image_id`, so the picker can show a result the catalog has no cover for
without a page loading an image from IGDB. It needs no session. Only an image
that a cached search returned in the last 24 hours is served, and never one of
a game a site admin hid or deleted; anything else is `404`
`game_cover_not_found`. The image ID is the `ETag`, and the response is
`public, max-age=604800, immutable`, since IGDB never changes the image behind
an ID; a matching `If-None-Match` gets `304` without calling IGDB. It answers
`503` `igdb_not_configured` without IGDB credentials and `503`
`igdb_unavailable` when IGDB fails. Nothing is stored. The web app serves it at
`/api/igdb-covers/{image_id}`.

`POST /events`, `PATCH /events/:slug`, and `POST /teams` take two fields beside
`game_ids`. A team needs at least one game across the three. An event may have
none, such as a club's informational meeting, and an edit can remove them all.

- `igdb_game_ids`: up to five IGDB IDs from the search. Each is imported as an
  active game with its cover if the catalog does not hold it. If the cover
  cannot be downloaded or used, the game is imported without it.
- `other_game`: a game name of up to 100 characters. It becomes an unlisted
  game that this event or team uses; the same name typed again reuses it. It
  goes through the blocked-language check.

Games IGDB tags with its "Erotic" theme are treated as if IGDB did not list
them: every search leaves them out, and a pick or refresh by ID answers
`igdb_game_not_found`.

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
| Games               | List, get, update, and delete under `/games`, plus `GET /games/:id/audit`; admins never add games                 |
| IGDB                | `POST /games/:id/refresh` and `GET /games/:id/cover`                                                              |
| Users               | List, get, `suspend`, `reactivate`, `PATCH /users/:id/trust-grants`, and `GET /users/:id/audit`                   |
| Site admins         | `GET`/`POST /site-admin-grants`, `POST /site-admin-grants/:id/revoke`, and `GET /site-admin-grants/:id/audit`     |
| System              | `GET /system`                                                                                                     |
| Audit log           | `GET /audit`                                                                                                      |

`GET /system` needs `system.read`. It probes school logo storage and IGDB each
time it is called and returns
`{ "checks": [{ "name", "status" }], "email_outbox": { "pending", "retrying", "failed", "oldest_pending_at" } }`.
`name` is `object_storage` or `igdb`; `status` is `ok`, `unreachable`, or
`not_configured`. A probe that fails or takes longer than three seconds is
`unreachable`; its cause is logged and never returned. `pending` counts every
message still due to be sent, `retrying` the pending messages that have failed
at least once, and `failed` the messages that stopped retrying in the last
seven days. The route is read-only and cannot report an outage of the API or
the database, since it is served by both.

`GET /audit` needs `audit.read` and lists every audited change, newest first.
It takes `limit`, one of `after` or `before`, and an optional `entity_type`
(`report`, `support_ticket`, `school`, `school_admin`, `game`, `user`, or
`site_role_grant`). It returns `{ "audit_entries", "next_cursor",
"previous_cursor" }`. Each entry carries the fields of an entity's audit
history plus the record to open for it: `target_type` (`report`,
`support_ticket`, `school`, `game`, or `user`), `target_id`, and
`target_name`. A school-admin grant points at its school and a site-admin
grant at its user. Reports and support tickets have no `target_name`.

The IGDB routes need `games.manage`. Admins do not search IGDB or import games;
users add them from the event and team forms.

- `POST /games/:id/refresh` takes `{ "expected_updated_at", "reason" }`. It
  sets `last_synced_at`, replaces the cover only when IGDB's image changed,
  never changes the name or slug, and writes a `game.refreshed` audit row. A
  game that was not imported gets `422` `game_not_from_igdb`.
- `GET /games/:id/cover` returns `{ "content_type", "data" }` with the bytes
  base64-encoded, so the Admin Console can show the cover of a hidden game
  without loading an image from another origin.

Games in admin responses also carry `igdb_id`, `last_synced_at`, `has_cover`,
and `user_submitted`. A refresh that fails uses these codes: `503` `igdb_not_configured`
(no `IGDB_CLIENT_ID` and `IGDB_CLIENT_SECRET` on the API), `503`
`igdb_rate_limited`, `502` `igdb_unavailable`, `404` `igdb_game_not_found`,
`422` `igdb_game_invalid`, and `422` `igdb_cover_unusable` (larger than 100 KB
or not a JPEG, PNG, or WebP). A failed refresh changes nothing.

Bulk IGDB sync, impersonation, feature flags, and site announcements are later.

### Sitemap

| Method | Path       | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/sitemap` | Public, no session. `{ events, schools, teams }`, each a list of `{ slug, updated_at }` and nothing else, up to 10,000 per list. Events are `public` with audience `open`, `collegiate`, or none, not deleted, and ended within the last 90 days or still ahead; unlisted and private events and events for a campus or group are never listed. Schools are active; teams are not deleted. People are never listed. Cached like the catalog |

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
- Pagination on every unbounded list endpoint; `GET /games` without `q` returns the whole active list

## TanStack usage

- **TanStack Start and TanStack Router** — main site in `apps/web`; the Admin Console in `apps/admin`
  uses the same framework in a separate deployment.
- **TanStack Query / Table / Form** — fine in the Admin Console or selective
  main-site features when a measured need exists.
- Do not add client data libraries by default to routes that work with loaders,
  server functions, and normal HTML forms.
