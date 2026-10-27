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
- **Idempotency** — `POST /events`, `POST /teams`, `POST /events/:slug/report`, `POST /users/:public_id/report`, and `POST /support-tickets` require an `Idempotency-Key` UUID header; a missing or malformed key returns `400 invalid_idempotency_key`. Repeating a key returns the record the first request created (`201`) instead of inserting another. A key whose record belongs to a different submitter or target, or was since deleted, returns `409 idempotency_key_reused`. The web app renders one key per form, so double submits and retries after a timeout do not create duplicates. RSVP, interest, follow, and join writes are upserts, and email delivery is deduplicated by `email_outbox.idempotency_key`
- **Health** — `GET /health` (liveness) and `GET /ready` (DB connectivity)
- **Errors** — structured error codes; no stack traces to clients. Every error is `{ "error": "<code>" }`. A method a path does not accept returns `405 method_not_allowed` with an `Allow` header. A body over the size limit returns `413 request_too_large`. A negative or non-numeric `offset` returns `400 invalid_offset`, and a malformed team path returns `400 invalid_team_slug`. A wrong private event password returns `401 invalid_private_password`, and a wrong team password `401 invalid_team_password`. Actions that need an unlocked private event (RSVP and interest) return `403 private_event_locked` until the viewer unlocks it. A store that is not configured returns `503 database_unavailable`; a failed read or write returns `500` with a code that names the operation, such as `event_unavailable` or `team_create_failed`
- **Audit/activity** — administrative changes write `audit_logs` entries in the same transaction as the change; user-facing activity history is later
- **Feature flags** — later; when added, evaluate server-side

## Endpoint surface (v1 intent)

Paths marked **(planned)**, and every path in a section marked (later), are not
implemented yet; align them with [05 — Roadmap](./05-roadmap.md) when they are built.
All other paths exist in the Go API.

### Auth

| Method | Path                         | Notes                                                                                                                                                                                                                                                     |
| ------ | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/auth/signup`               | Rate limited; requires 18+ confirmation, home school selection, and the [policy claim](#policy-acceptance); sends verification email                                                                                                                      |
| POST   | `/auth/login`                |                                                                                                                                                                                                                                                           |
| POST   | `/auth/logout`               |                                                                                                                                                                                                                                                           |
| POST   | `/auth/forgot-password`      |                                                                                                                                                                                                                                                           |
| POST   | `/auth/reset-password`       |                                                                                                                                                                                                                                                           |
| POST   | `/auth/verify-email`         | Consumes the token after explicit confirmation on the web verification page; direct GET returns 405                                                                                                                                                       |
| POST   | `/auth/resend-verification`  | Rate limited                                                                                                                                                                                                                                              |
| POST   | `/auth/confirm-email-change` | `{ "token" }` from the link sent to a new address; no session needed. Rate limited per visitor and per token. A missing, used, expired, or superseded token, or an address another account took since the request, returns `400 invalid_or_expired_token` |

Logging in: `POST /auth/login` returns `401 invalid_credentials` for an unknown
or deleted email or a wrong password, `403 account_suspended` when the password
is correct but an operator suspended the account, and `403 email_not_verified`
for a correct password on an unverified account. Because `account_suspended`
needs the password, it never reveals an account's status to anyone else. None
of these creates a session. Suspending an account also ends its sessions, and a
session for an account that is not active no longer authenticates.

Changing an email: `POST /me/email` retires any earlier pending change and
queues the link to the new address, valid for the verification TTL. Following
it (`POST /auth/confirm-email-change`) moves the account to the new address,
marks it verified, and queues a notice to the old address that names neither
address and points to the password reset page. A password change and an email
change each write an audit row (`user.password_changed`,
`user.email_changed`) with the account as actor and target and no values.

### Data export

`POST /me/export` returns `200` with `Cache-Control: private, no-store` and one JSON object: `format_version` (now `1`), `exported_at`, an `account` object (email, name, bio, time zone, trust level, status, list visibility, verification and age-confirmation times, home school), and arrays for `social_links`, `followed_schools`, `school_admin_roles`, `site_roles`, `game_lists`, `teams`, `clubs` (the account's club roles), `club_claims` (its claims and club requests, with the evidence it sent), `events_organized`, `rsvps`, `interested_events`, `tournament_entries` (its solo entries and the team entries whose roster it is on), `support_tickets`, `reports`, `notifications`, `policy_acceptances`, `sessions`, and `active_days` (the UTC dates, `YYYY-MM-DD`, on which the account made a signed-in request, from the last 13 months). Timestamps are UTC. It carries no password hash, token, or session token hash, and leaves out other people's data except what the account itself submitted (a report names the reported account's ID). The sections are read in one snapshot, and each download writes a `user.data_exported` audit row with the account as actor and target in the same transaction. Nothing is stored for later: the file is built on request and not kept.

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

| Method | Path                         | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------ | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/me`                        | Profile + timezone + home school summary + role indicators + `show_in_lists` (private; never on the public profile)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| PATCH  | `/me`                        | Name, bio, [social links](#social-links), timezone, and `show_in_lists` (boolean opt-out from the [people lists](#people-lists)); an absent field is left unchanged and a non-boolean `show_in_lists` returns `400 invalid_json`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| DELETE | `/me`                        | Anonymize the account in place and return 204. Scrubs email, name, bio, and timezone; marks `account_status = 'deleted'`; hard-deletes social links, school follows, profile game lists, RSVPs, interests, notifications, activity days, and team/event roles (which takes the account off team rosters for tournaments that have not started); withdraws its solo entries from tournaments that have not started; revokes sessions and drops outstanding tokens and queued email; revokes school-admin and site-admin grants while keeping their history. Teams they own pass to the longest-tenured captain, else the longest-tenured member, else are soft-deleted. Events they created that have not ended pass to the longest-tenured active co-organizer; the rest are archived, and active yes/maybe RSVPs to those that have not ended get a best-effort cancellation email and an inbox notice. Returns `409 last_site_admin` when the account is the last active site admin. The scrubbed email releases the original address for re-registration. See [16 — Legal and data-lifecycle plan](./16-legal-and-data-lifecycle-plan.md). |
| POST   | `/me/password`               | Auth; `{ "current_password", "new_password" }`; rate limited per account. A wrong current password returns `422 invalid_current_password`; a new password under 8 characters `400 invalid_request`. On success (204) every other session ends, the requesting one stays signed in, and outstanding reset links stop working                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| POST   | `/me/email`                  | Auth; `{ "current_password", "new_email" }`; rate limited per account. Sends a confirmation link to the new address and returns `202`; the email changes only when the link is used. The same `202` comes back, with no email sent, when another account uses the address. A wrong password returns `422 invalid_current_password`, the current address `400 email_unchanged`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| POST   | `/me/export`                 | Auth; `{ "current_password" }`; rate limited per account. Returns everything held about the account as JSON ([data export](#data-export)); a wrong password returns `422 invalid_current_password`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| GET    | `/me/schools`                | Followed schools                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| GET    | `/me/events`                 | Dashboard event sections: upcoming RSVPs, upcoming events the caller marked "interested" (`interested_events`, soonest first), and followed-school public events                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| GET    | `/me/created-events`         | Auth; `private, no-store`; `{"events", "next_cursor"}`: every live event the caller created, past and upcoming, latest start first; `limit` 1–50 (default 20) and `after` cursor; a malformed cursor or out-of-range `limit` is `400 invalid_cursor` or `400 invalid_limit`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| GET    | `/me/clubs`                  | Auth; `private, no-store`; `{"clubs": [{"id", "name", "slug", "school": {"id", "name", "slug"}, "viewer_role"}]}`: the published clubs the caller is in, clubs they own or edit first, then by name; at most 100. The event form offers the ones they own or edit as hosts                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| GET    | `/me/teams`                  | Dashboard team activity                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| GET    | `/me/games`                  | The caller's [profile game lists](#profile-game-lists)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| POST   | `/me/games`                  | Auth; add games to one [profile game list](#profile-game-lists); rate limited per account                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| DELETE | `/me/games/:gameId`          | Auth; take a game off whichever list holds it; rate limited per account                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| POST   | `/me/games/:gameId/position` | Auth; `{ "position" }`; move a listed game within its list; rate limited per account                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| GET    | `/me/activity`               | **(planned)** Full user activity log                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| GET    | `/users/:public_id`          | Public profile by [public ID](#user-public-ids), including `home_school_id`, display-ready `home_school`, [social links](#social-links), verification level, role indicators when available, and `games`, the [profile game lists](#profile-game-lists)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| POST   | `/users/:public_id/report`   | Rate limited                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

#### User public IDs

A user has two IDs. `id` is the internal UUID: other endpoints, such as
`DELETE /events/:slug/organizers/:user_id`, take it. `public_id` is ten base58
characters (digits and letters without `0`, `O`, `I`, and `l`), assigned at
signup and never changed, and is the only ID a profile URL uses. `/me`, public
profiles, event `organizers`, and [people lists](#people-lists) carry both.
`GET /users/:public_id` and `POST /users/:public_id/report` answer
`400 invalid_id` for anything that is not a public ID, including a UUID. A
public ID with no active user returns `404 user_not_found` from the profile and
`404 report_target_not_found` from the report.

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

#### Profile game lists

A profile lists games in three ordered lists: `favorite`, `like`, and
`want_to_play`. `GET /me/games`, every `/me/games` write, and the `games` field
of `GET /users/:public_id` return them as
`{ "favorite": [...], "like": [...], "want_to_play": [...] }`, each game with
`id`, `name`, `slug`, and `cover_url` when it has a cover. A game the catalog
deletes drops off every list. The lists are as visible as the profile itself;
there is no per-list privacy setting.

- A game is in at most one of a user's lists. Adding a game that is in another
  list moves it to the end of the new one; adding a game already in the list
  leaves it where it is.
- `favorite` holds at most 5 games. Adding past that returns
  `409 favorite_games_full` and adds none of the request's games. The other
  lists are uncapped.
- `POST /me/games` takes `list` and up to 10 games picked the way an event or
  team form picks them: `game_ids` from the catalog, `igdb_game_ids` from an
  IGDB search, and `other_game`, a typed name. They are added in that order. An
  unknown list, no games, or more than 10 returns `400 invalid_request`; a
  hidden or deleted game `422 game_unavailable`.
- `POST /me/games/:gameId/position` takes a `position` counted from 0; a
  position past the end moves the game to the end. Removing or moving a game
  that is not listed returns `404 listed_game_not_found`.

### Clubs

| Method | Path                                  | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------ | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/clubs`                              | Public; the clubs directory: published clubs at active schools, by name. `q` (part of the name, ignoring case; at most 100 characters), `school` and `game` slugs, `type`, `limit`, and opaque `after`/`before` cursors; response includes `has_more` and `has_previous`. `400 invalid_type`, `invalid_query`, `invalid_limit`, or `invalid_cursor`                                                                                  |
| GET    | `/clubs/:slug`                        | Public; one published club. A slug the club had before a rename returns the club with its current `slug`, and the web page redirects there. `404 club_not_found` for a hidden, deleted, or missing club                                                                                                                                                                                                                              |
| GET    | `/clubs/:slug/manage`                 | Owner or editor; `{"club", "role", "members": [{"user_id", "public_id", "name", "role", "joined_at"}], "invites": [{"id", "email", "expires_at", "created_at"}], "ownership_offer"?: {"user_id", "name", "created_at"}}`. `invites` is empty for an editor. `403 not_club_officer` for anyone else                                                                                                                                   |
| POST   | `/clubs/:slug/profile`                | Owner or editor; `{"name", "type", "summary", "how_to_join", "game_ids"}` replaces the club's details and games (at most 20). The slug, school, and status stay with site admins. `204`; `400` for invalid fields or blocked language, `422 club_game_not_found`                                                                                                                                                                     |
| POST   | `/clubs/:slug/confirm`                | Owner or editor; confirms the club's details are current. Sets `confirmed_at` to now and `confirmed_source` to `club`. `204`                                                                                                                                                                                                                                                                                                         |
| POST   | `/clubs/:slug/links`                  | Owner or editor; `{"links": [{"type", "label", "url"}]}` replaces the links in order (at most 10, `http`/`https` only). `204`                                                                                                                                                                                                                                                                                                        |
| POST   | `/clubs/:slug/editor-invites`         | Owner; `{"email"}`. Emails a link that works once, expires in 7 days, and only for a signed-in account with that address; answers the same whether or not the address has an account, and inviting it again replaces its pending invite. `201` with the invite; `409 editor_invite_limit_reached` past 10 pending, `429` past the per-account limit                                                                                  |
| DELETE | `/clubs/:slug/editor-invites/:id`     | Owner; withdraws a pending invite. `204`; `404 editor_invite_not_found`                                                                                                                                                                                                                                                                                                                                                              |
| POST   | `/club-editor-invites/accept`         | Auth; `{"token"}` from the invite email; returns `{"club_slug"}`. A member becomes an editor; an owner or editor keeps their role. `403 editor_invite_wrong_account` for another account, `404 editor_invite_not_found` for a used, withdrawn, or expired link                                                                                                                                                                       |
| POST   | `/clubs/:slug/remove-member`          | Owner or editor; `{"user_id"}`. Owners remove editors and members, editors remove members, and no one removes an owner (`409 club_owner_cannot_be_removed`). The club and what it published are unchanged. `204`                                                                                                                                                                                                                     |
| POST   | `/clubs/:slug/join`                   | Signed in, verified email; lists the user on the club as a member. It grants nothing in the club itself. Joining again, or as an owner or editor, changes nothing, and a removed member may join again. `204`; `403 email_verification_required`, `404 club_not_found`, `429` past the per-account limit                                                                                                                             |
| GET    | `/clubs/:slug/members`                | Signed in; a [people list](#people-lists) of the club's owners, then editors, then members, with each person's `role`. `401` for a visitor, who sees the club's `member_count` instead; `404 club_not_found`                                                                                                                                                                                                                         |
| POST   | `/clubs/:slug/leave`                  | Anyone in the club; `204`. `409 last_club_owner` for the last owner                                                                                                                                                                                                                                                                                                                                                                  |
| POST   | `/clubs/:slug/ownership-offer`        | Owner; `{"user_id"}` of an editor or member, who is emailed. Nothing changes until they accept; a new offer replaces the old one. `204`                                                                                                                                                                                                                                                                                              |
| DELETE | `/clubs/:slug/ownership-offer`        | An owner withdraws the offer, or its recipient declines it. `204`; `404 ownership_offer_not_found`                                                                                                                                                                                                                                                                                                                                   |
| POST   | `/clubs/:slug/ownership-offer/accept` | The offer's recipient becomes an owner, and the owner who made it becomes an editor. `204`; `404 ownership_offer_not_found`                                                                                                                                                                                                                                                                                                          |
| POST   | `/clubs/:slug/claims`                 | Signed in, verified email; claim a published club for site-admin review. Body `{"evidence_text", "evidence_url"}`; returns `201 {"status": "pending"}`. `401 authentication_required`, `403 email_verification_required`, `404 club_not_found`, `409 club_already_claimed` (the club has an owner) or `club_claim_pending` (this user already has a pending claim on it), `429` past the per-account limit shared with club requests |

A club is `{"id", "name", "slug", "type", "summary", "how_to_join", "school", "games", "links", "claimed", "member_count", "confirmed_at", "confirmed_source", "needs_confirmation"}`.
`member_count` counts everyone who joined on CGN, owners and editors included,
whether or not they show in people lists.
`type` is `student_club` or `university_program`; neither implies university
endorsement. `how_to_join` is the club's own process for becoming a member and
is omitted when the club has not said. `links` are `{"type", "label", "url"}`
with `type` `website`, `discord`, or `social`, in the club's order, and only
`http` or `https` URLs; they are information, not the way to join. `claimed`
is `true` once a site admin approves a claim and the club has an owner, and
`false` while CGN maintains it. For a signed-in viewer the club also carries
`viewer`: `{"role"?, "ownership_offered"?}`, their role (`owner`, `editor`, or
`member`) and whether an owner offered them the club; that response is
`Cache-Control: private, no-store`.

Each club command above checks the person's role in that club on the server,
needs a signed-in user (`401 authentication_required`), and writes an audit
record on the club (`club.profile_edited`, `club.links_edited`,
`club.details_confirmed`,
`club.editor_invited`, `club.editor_invite_revoked`, `club.editor_added`,
`club.member_removed`, `club.member_left`, `club.ownership_offered`,
`club.ownership_offer_cancelled`, `club.ownership_transferred`). Audit states
hold user IDs and roles only. `403 not_club_officer` or `not_club_owner` when
the role is missing.
`confirmed_at` and `confirmed_source` (`club` or `cgn`) are omitted until the
details have been confirmed. `needs_confirmation` is `true` once
`confirmed_at` is more than 90 days old, and `false` for a club never
confirmed; list rows carry it too. Each game carries `has_cover`, as on events.
Every hour the API emails the owners of each claimed club that has lapsed
(`club_confirmation_due`), once per lapse.

`GET /clubs` returns `{"clubs": [{"id", "name", "slug", "type", "summary", "games", "claimed", "needs_confirmation", "school"}], "limit", "has_more", "has_previous", "next_cursor"?, "previous_cursor"?}`,
where `school` is `{"id", "name", "slug", "city"?, "state"?}`. An unknown
school or game slug matches no clubs.
A claim or club request carries the applicant's evidence: `evidence_text`
(required, at most 2,000 characters) and `evidence_url` (optional, `http` or
`https`, at most 500 characters). Both pass the blocked-language filter. The
evidence, the applicant's email, and the review note appear only in the Admin
API; the public responses carry nothing but the receipt. Site admins create
and edit clubs, and approve or reject claims, through the
[Admin API](./20-admin-console-v1-engineering-plan.md#clubs); owner and editor
and site admins remove members through `POST /admin/v1/clubs/:id/remove-member`.

### Schools

| Method | Path                           | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------ | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/schools`                     | Search/browse (public, incl. logged out); `q`, `state`, `limit`, and `offset`; `q` matches part of a school's name or alias, ignoring case and accents (until the in-memory catalog first loads, accents must match); response includes `has_more` (no total count). `sort=popular` instead returns the most active schools, ranked by active members plus hosted public events (ties: more members, then name), omitting schools with no activity; it takes only `limit` (default 6, at most 50), any other filter or sort returns `400 invalid_sort`, and the ranking is cached for five minutes |
| GET    | `/schools/:slug`               | Public school page; its clubs come from `/schools/:slug/clubs`. School objects include `logo_url` when a logo is set                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| GET    | `/schools/:slug/members`       | Auth required; the [people list](#people-lists) of users whose home school it is; `404 school_not_found` when missing                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| POST   | `/schools/:slug/club-requests` | Signed in, verified email; ask for a club the school does not list, for site-admin review. Body `{"name", "type", "evidence_text", "evidence_url"}` (see [Clubs](#clubs)); returns `201 {"status": "pending"}`. `404 school_not_found` for a missing or inactive school, `409 club_already_listed` when a published club at the school has that name, `409 club_claim_pending` when this user already asked for that name there; otherwise as `POST /clubs/:slug/claims`                                                                                                                           |
| GET    | `/schools/:slug/clubs`         | Public; the school's published [clubs](#clubs), by name: `{"clubs": [{"id", "name", "slug", "type", "summary", "games", "claimed", "needs_confirmation"}]}`; `404 school_not_found` for a missing or inactive school                                                                                                                                                                                                                                                                                                                                                                               |
| GET    | `/school-stats`                | Public activity counts; repeat `school=<slug>` for up to 50 schools (`400 too_many_schools` past that)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| POST   | `/schools/:id/follow`          | Auth required                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| DELETE | `/schools/:id/follow`          |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| PATCH  | `/schools/:id`                 | **(planned)** School admin only; site admins edit schools through the [Admin API](#admin-api)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

`GET /school-stats` returns `{"stats": [{"slug", "members", "teams", "upcoming_events"}]}` for the active schools among the requested slugs, ordered by slug; unknown and inactive slugs are left out, and no slugs returns an empty list. The counts are CGN activity, not enrollment, and are read live in one query rather than from the catalog cache. `members` counts active accounts with the school as home school, including people who left member lists; `teams` counts teams at the school that are not deleted; `upcoming_events` counts public events the school hosts that have not ended. The `sort=popular` ranking counts all public events, past ones included, so it can order schools differently from `upcoming_events`.

### Teams

| Method | Path                              | Notes                                                                                                                                                                                |
| ------ | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| POST   | `/teams`                          | Anyone authenticated                                                                                                                                                                 |
| GET    | `/teams`                          | Public browse; `game`, `school`, `limit`, and opaque `after`/`before` cursors; response includes `has_more` and `has_previous`                                                       |
| GET    | `/teams/:slug`                    | **Public** team page                                                                                                                                                                 |
| GET    | `/teams/:slug/members`            | Auth required (the team page itself is public); the [people list](#people-lists) of members with their `role`; `404 team_not_found` when missing                                     |
| POST   | `/teams/:slug/join`               | Password required to join/interact                                                                                                                                                   |
| POST   | `/teams/:slug/transfer-ownership` | Owner                                                                                                                                                                                |
| POST   | `/teams/:slug/captains`           | Assign captains                                                                                                                                                                      |
| POST   | `/teams/:slug/leave`              | Auth; a member or captain leaves (no body). The owner gets `409 team_owner_cannot_leave` and must transfer ownership first; a non-member gets `422 team_member_not_found`            |
| POST   | `/teams/:slug/remove-member`      | Owner; `{ "user_id" }` of another member or captain. A non-owner gets `403 not_team_owner`, a non-member `422 team_member_not_found`, and the owner's own ID `400 invalid_team_role` |
| GET    | `/teams/:slug/audit`              | **(planned)** Team change history                                                                                                                                                    |

Each entry in a team's `games`, in the browse list, the team page, and the
signed-in user's teams, is `{ "id", "name", "slug", "has_cover" }`, with
`has_cover` meaning what it means for [an event's games](#events): the site
serves the cover at `/api/games/:slug/cover`. Team rows show the first game's
cover.

Leaving or being removed ends the membership and clears any captain role. The person may rejoin with the team password and starts again as a member. Events the team hosts keep the team. Neither operation writes an audit record, the same as captain changes and ownership transfers; team change history is planned under `/teams/:slug/audit`.

### Events

| Method | Path                                        | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------ | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/events`                                   | Search/browse **public only**, events under way or upcoming, soonest start time first (ended events are left out); `game`, `school`, `team` (the hosting team's slug), `club` (the hosting club's slug), `q` (title contains, any case, at most 100 characters; longer is `400 invalid_query`), `from` and `to` (inclusive `YYYY-MM-DD` days of the event's start in its own time zone; a malformed date or `from` after `to` is `400 invalid_date_range`), `format`, `type`, `audience`, `cost`, `starts_after` and `starts_before` (RFC 3339; at or after, and before; an empty or malformed range is `invalid_time_range`), `limit`, and opaque `after`/`before` cursors; response includes `has_more` and `has_previous` |
| GET    | `/events/:slug`                             | Public & unlisted return full page; private returns gated shell until unlocked. A cancelled public or unlisted event is returned with `cancelled_at` for 24 hours after its cancellation, then `404 event_not_found`; a cancelled private event is `404` at once                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| GET    | `/events/:slug/attendees`                   | Auth required; the [people list](#people-lists) of RSVPs, `response=yes` (default) or `maybe`; follows the event page's access rules and answers `404 event_not_found` for a missing, cancelled, or still-locked private event                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| POST   | `/events/:slug/unlock`                      | Password for private events; unlock session required before details/RSVP                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| POST   | `/events`                                   | Auth; no approval; rate limited; 8-char slug hash; required `event_type` and `audience`; optional capacity; optional off-site payment fields; default banner only; optional `recurrence_rule` (`weekly`, `biweekly`, `monthly`) and `recurrence_until` (`YYYY-MM-DD`)                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| PATCH  | `/events/:slug`                             | Organizers and the host club's owners and editors; `409 event_ended` once the event has ended. Recurrence is set at creation and occurrences are edited independently. Supplying either recurrence field returns `400 event_recurrence_immutable`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| DELETE | `/events/:slug`                             | The creator, or an owner or editor of the host club (`403 not_event_creator` for co-organizers); `409 event_ended` once the event has ended; soft-cancel; best-effort email to active yes/maybe RSVPs and tournament entrants after cancellation                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| POST   | `/events/:slug/rsvp`                        | yes/no/maybe; capacity counts **yes only**; reject yes if full; email+ICS on yes, with the start time shown in the event's time zone                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| POST   | `/events/:slug/interest`                    | Favorite/bookmark; independent of RSVP                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| DELETE | `/events/:slug/interest`                    | Remove favorite                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| POST   | `/events/:slug/report`                      | Rate limited                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| GET    | `/events/:slug/organizer-invites`           | The creator only; pending, unexpired [co-organizer invites](#co-organizers)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| POST   | `/events/:slug/organizer-invites`           | The creator only; invite an email address to co-organize; rate limited                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| DELETE | `/events/:slug/organizer-invites/:id`       | The creator only; withdraw a pending invite                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| DELETE | `/events/:slug/organizers/:user_id`         | The creator removes a co-organizer, or a co-organizer steps down                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| POST   | `/events/:slug/organizers/:user_id/creator` | The creator hands the creator role to a co-organizer                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| POST   | `/organizer-invites/accept`                 | Auth; `{"token"}` from the invite email; returns `{"event_slug"}`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| GET    | `/events/:slug/activity`                    | The event's [activity log](#event-activity-log), filtered to what the viewer may see                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

An event's `event_type` (`game_night`, `lan`, `tournament`, `watch_party`, `tryout`, `meeting`, `workshop`, or `other`) says what kind of event it is. It is required on `POST /events` and `PATCH /events/:slug`; a missing or unknown value returns `400 invalid_request`. Responses include it when set, and events created before the field omit it. `GET /events` filters on it with the `type` query parameter and ignores an unknown value. The `tournament` type is a label only and creates no tournament.

An event's `audience` (`open`, `collegiate`, `campus`, or `members`) says who it is for. It is required on `POST /events` and `PATCH /events/:slug`; a missing or unknown value returns `400 invalid_request`. Responses include it when set, and events created before the field omit it. An unknown `audience` filter on `GET /events` is ignored. Audience is informational: it does not gate the page, RSVPs, or interest. The RSVP confirmation email and its `.ics` description include it.

An event's `host_team` (`id`, `name`, `slug`) is the team that hosts it; responses omit it when the organizer runs the event alone. `POST /events` and `PATCH /events/:slug` accept an optional `host_team_id`; an empty or missing value means no team. Choosing a team the requester does not own or captain, or one that does not exist, returns `422 host_team_not_allowed`. An edit that keeps the event's current team needs no role, so an event keeps its team after its organizer leaves the team.

An event's `host_club` (`id`, `name`, `slug`) is the club that hosts it, and is omitted otherwise. `POST /events` and `PATCH /events/:slug` accept an optional `host_club_id`. Choosing a club the requester does not own or edit, or one that is hidden or does not exist, returns `422 host_club_not_allowed`; a club at a school other than `host_school_id` returns `422 host_club_school_mismatch`, on every edit. Keeping the event's current club needs no role. Sending both `host_team_id` and `host_club_id` returns `400 invalid_request`. Every owner and editor of the host club can edit and cancel the event and sees its `online_url`; the event detail sets `viewer_can_edit` and `viewer_can_cancel` for them. That access follows the club's roles, so it ends when the person leaves the club unless they also organize the event.

Event responses include `revision` and `updated_at`. `revision` starts at 0 and rises whenever a field its calendar file shows changes (title, description, audience, times, time zone, format, place, or online link) and when the event is cancelled; a save that changes none of them leaves it. The web `.ics` export and the RSVP email's attachment both write it as `SEQUENCE`, `updated_at` as `LAST-MODIFIED`, and `STATUS:CONFIRMED` or `STATUS:CANCELLED`, so the two files for one event state are identical and a calendar replaces an imported entry after a change.

An event's `cost` is `free`, `paid`, or `unspecified`; it replaces the former `is_paid` boolean. Every event response includes it. `POST /events` and `PATCH /events/:slug` accept it, store a missing value as `unspecified`, and return `400 invalid_request` for an unknown value. `unspecified` means the organizer did not say and is never treated as free. `GET /events?cost=free` returns only events declared free; an unknown `cost` filter is ignored. `payment_note` and `payment_url` are unchanged and describe paid events.

An event's `online_url` is sent only to a requester whose RSVP is `yes` or who organizes the event; everyone else receives the event without it, and `GET /events` never includes it. See [07 — Permissions](./07-permissions.md#event-rules).

Each entry in an event's `games` is `{ "id", "name", "slug", "has_cover" }`. `has_cover` is true when the site serves the game's cover at `/api/games/:slug/cover`, so it is false for a game with no stored cover and for one a site admin has hidden since the event chose it.

Every event response, lists included, carries `tournament_entries` when the event has a tournament past draft: `{ "entry_type", "entry_count", "entrant_cap" }`, where `entry_count` counts registered entries (not pending requests) and `entrant_cap` is left out when there is no limit. List rows show it in place of the RSVP count and `capacity`, which a tournament does not use. For the same reason a tournament event's `lifecycle` is `full` when `entry_count` reaches `entrant_cap`, not when RSVPs reach `capacity`, and a tournament without a cap is never `full`.

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

### Co-organizers

An event's creator invites co-organizers by email. Event detail responses set `viewer_is_creator` for the creator, beside `viewer_can_edit` for every organizer and `viewer_can_cancel` for the creator and the host club's owners and editors. A co-organizer can edit the event and step down; only the creator can cancel it, invite, withdraw invites, remove co-organizers, and hand the creator role to a co-organizer, who then holds all of those rights while the former creator stays on as a co-organizer. Anyone else gets `403 not_event_creator`, and a request from someone who does not organize the event gets `403 not_event_organizer`.

- `POST /events/:slug/organizer-invites` takes `{"email"}` and returns `201` with the invite (`id`, `email`, `expires_at`, `created_at`) whether or not the address has an account, and the invite email always goes out, so an invite reveals nothing about who is registered. A malformed address is `400 invalid_email`. Inviting an address that already has a pending invite replaces it. An event has at most 10 organizers and pending invites together; past that the answer is `409 organizer_limit_reached`.
- The email links to `/organizer-invite?token=…`, which asks the person to confirm. A private event's title is left out of the email. The link expires after seven days and works once.
- `POST /organizer-invites/accept` needs a session for the account with the invited address; another account gets `403 organizer_invite_wrong_account` and leaves the invite usable. An expired, used, withdrawn, or replaced invite, or one for a cancelled event, is `404 organizer_invite_not_found`.
- The creator cannot be removed (`409 creator_cannot_leave`); they hand the creator role on first. A removed co-organizer or unknown user ID is `404 organizer_not_found`.
- Finished invites are deleted a day after they expire, are accepted, or are withdrawn, and deleting an account deletes the invites sent to its address.

### Event activity log

`GET /events/:slug/activity` returns the [activity log](./02-domain-model.md#event-activity-log) newest first, as `{"entries", "next_cursor"}`, with `Cache-Control: private, no-store` because the answer depends on the viewer. It needs no session. It follows the event page's access rules: a missing event, a locked private event, or an event cancelled more than 24 hours ago is `404 event_not_found`. It takes `limit` 1–50 (default 20) and an `after` cursor; a malformed cursor or out-of-range `limit` is `400 invalid_cursor` or `400 invalid_limit`.

Each entry has `id`, `action`, `occurred_at`, `visibility` (`public` or `editors`), and `changes`, a list of `{"field", "before", "after"}` for an `event.updated` entry and empty otherwise. `before` and `after` are left out for a field recorded as changed only. Times are RFC 3339 in UTC; a team, club, or school is `{"name", "slug"}`, or `null` when there was none. For `games`, `before` lists the games removed and `after` the games added, each `{"name", "slug"}`.

The API filters the log on the server. A viewer who can edit the event (`viewer_can_edit` on the event detail) gets every entry, each with `actor`: `{"name", "public_id"}`, or `null` for an account that has since been deleted. Anyone else gets only public entries, without `actor`, and an `event.updated` entry lists only its public fields; the cursor pages over that filtered list. A cancelled event has no editors, so during its 24 hours everyone gets that public view.

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

### Tournaments

A tournament lives under its event; there is no `/tournaments` resource. The
settings, status, registration, seeding, bracket, and result routes are
built.

| Method | Path                                           | Notes                                                                        |
| ------ | ---------------------------------------------- | ---------------------------------------------------------------------------- |
| PUT    | `/events/:slug/tournament`                     | Organizers; create (`201`) or replace (`200`) the settings                   |
| DELETE | `/events/:slug/tournament`                     | Organizers; draft only; `204`                                                |
| POST   | `/events/:slug/tournament/status`              | Organizers; move the status; invalid moves `409`                             |
| GET    | `/events/:slug/tournament/entries`             | Entrant list in seed order; solo names for signed-in viewers only            |
| POST   | `/events/:slug/tournament/entries`             | Auth; register yourself, or a team with its roster (owner or captain); `201` |
| PATCH  | `/events/:slug/tournament/entries/:id`         | Team owner or captain; replace the roster, before start                      |
| DELETE | `/events/:slug/tournament/entries/:id`         | Withdraw (entrant) or remove (organizers), before start; `204`               |
| POST   | `/events/:slug/tournament/entries/:id/approve` | Organizers; approve a pending request, before start; returns the entry       |
| POST   | `/events/:slug/tournament/entries/:id/decline` | Organizers; decline a pending request, before start; returns the entry       |
| GET    | `/events/:slug/tournament/my-teams`            | Auth; teams the viewer owns or captains, with their members, for a roster    |
| PUT    | `/events/:slug/tournament/seeds`               | Organizers; order the registered entries from seed 1, until the first result |
| POST   | `/events/:slug/tournament/bracket`             | Organizers; generate or regenerate once started, until the first result      |
| GET    | `/events/:slug/tournament/matches`             | The bracket by round and position; empty until generated                     |
| POST   | `/events/:slug/tournament/matches/:id/result`  | Organizers; enter or correct a result or a walkover; returns the bracket     |

`PUT /events/:slug/tournament` takes `game_id` (one of the event's games),
`entry_type` (`solo` or `team`), `team_size` (2 to 20, team only),
`substitutes` (0 to the team size, team only), `entrant_cap` (2 to 512 or
omitted), `registration_closes_at` (no later than the event's start, or
omitted for the start), `format` (`single_elimination`, the default), `rules`,
`prizes`, and `bracket_url` (an `http` or `https` link of up to 500 characters
to a bracket on another site, or empty for none; a `PUT` without it removes
it). A new tournament starts in `draft`. Both routes answer with the
tournament object below. Errors:

- `400 invalid_request` for a value out of range
- `403 not_event_organizer` for anyone who cannot edit the event
- `404 event_not_found`, or `404 tournament_not_found` for a status change or
  delete on an event without settings
- `409 tournament_event_type_required` when the event's type is not
  `tournament`
- `409 event_has_rsvps` when someone other than an organizer has RSVP'd
- `409 event_ended` for a change after the event ends (completing it is still
  allowed)
- `409 tournament_locked` for settings on a completed or cancelled tournament,
  or a delete after draft
- `422 tournament_game_not_on_event` for a game that is not one of the event's

`POST /events/:slug/tournament/status` takes `{ "status": "..." }`. The moves are
`draft` → `registration_open` or `cancelled`; `registration_open` → `draft`,
`in_progress`, or `cancelled`; `in_progress` → `completed` or `cancelled`.
Naming the current status changes nothing. Another move is
`409 invalid_tournament_status`, and an unknown status is
`400 invalid_tournament_status`. Moving back to `draft` with any entry is
`409 tournament_has_entries`, and starting with fewer than two entries is
`409 tournament_needs_entrants`. Once anyone has registered, a `PUT` that
changes `entry_type`, `team_size`, or `format` is `409 tournament_has_entries`.

`GET /events/:slug` includes `tournament` once settings exist, except a draft,
which only the event's organizers see:

```text
{
  "game": { "id", "name", "slug", "has_cover" },
  "entry_type": "team",
  "team_size": 5,
  "substitutes": 1,
  "entrant_cap": 16,
  "registration_closes_at": "2031-06-01T17:00:00Z",
  "format": "single_elimination",
  "rules": "",
  "prizes": "",
  "bracket_url": "https://www.start.gg/tournament/spring-cup",
  "status": "draft",
  "entry_count": 3,
  "viewer_entry": { "id", "team": { "id", "name", "slug" }, "can_manage": true }
}
```

`team_size`, `entrant_cap`, `registration_closes_at`, and `bracket_url` are
omitted when not set. `viewer_entry` is the signed-in viewer's own active entry: theirs alone,
one whose roster they are on, or one for a team they own or captain;
`can_manage` is set for the solo player and the team's owner and captains.

**Registration.** `POST /events/:slug/tournament/entries` takes `{}` for a solo
tournament, or `{ "team_slug", "roster": ["<public_id>", ...] }` for a team
one. It follows the event page's private access (`403 private_event_locked`)
and answers with the entry. `PATCH .../entries/:id` takes `{ "roster" }`. An
entry is

```text
{ "id", "seed", "player": { "public_id", "name" },
  "team": { "id", "name", "slug" }, "roster": [{ "public_id", "name" }],
  "registered_at" }
```

with `player` for a solo entry and `team` and `roster` for a team one. `seed`
is the entry's place in seed order (registration order until organizers seed).
`GET .../entries` returns `{ "entries": [...] }`, with `private, no-store`;
signed-in viewers see every name, regardless of `show_in_lists`, and signed-out
viewers get no `player` or `roster`. A withdrawn entrant who registers again
goes to the end of the order. Errors:

- `403 email_verification_required` for an account that has not verified its
  email
- `403 not_tournament_entrant` for a change by someone who is not the entrant
  (or, for a removal, an organizer)
- `404 tournament_not_found` for an event with no tournament, or a draft to
  anyone but its organizers; `404 tournament_entry_not_found`
- `409 tournament_registration_closed` unless the status is
  `registration_open` and registration has not closed
- `409 tournament_full` at the entrant cap
- `409 tournament_already_entered` for a person or team with an active entry
- `409 tournament_entry_removed` for an entrant an organizer removed
- `409 tournament_player_already_entered` for a roster player in another
  entry, solo or on a roster
- `409 tournament_started` for a roster change, withdrawal, or removal after
  the start
- `422 tournament_entry_type_mismatch` for a team in a solo tournament or the
  reverse
- `422 tournament_team_not_allowed` for a team the viewer does not own or
  captain
- `422 invalid_tournament_roster` for a roster outside the team size to the
  team size plus substitutes, with repeats, or with anyone who is not an
  active member of the team

Every entry carries `status`: `registered`, or `pending` for a request.
`seed` is omitted for a request.

**Approval.** `PUT /events/:slug/tournament` takes `registration_mode`
(`open`, the default when omitted, or `approval`), and the tournament object
returns it; switching to `open` while a request is pending is
`409 tournament_has_requests`. In approval mode `POST .../entries` creates an
entry with `"status": "pending"`. A request counts as the entrant's one entry
(so the uniqueness and roster rules apply, and it blocks moving back to draft
and changing the entry type, team size, or format) but is left out of
`entries`, the seed order, the cap, and `entry_count`; a full tournament
still refuses new requests with `409 tournament_full`. The requester cancels
it with `DELETE` and changes its roster with `PATCH`. Organizers get the
pending ones as `requests`, in request order, from `GET .../entries`, and as
`request_count` on the tournament object; neither is sent to anyone else.
`viewer_entry` carries `status`. `POST .../entries/:id/approve` returns the
registered entry, at the end of the seed order; `.../decline` returns
`{ "id", "status": "declined" }`. Both are for organizers
(`403 not_event_organizer`) until the start, even after registration closes
(`409 tournament_started` after it). Approving at the cap is
`409 tournament_full`, and either one on an entry that is not pending is
`409 tournament_entry_not_pending`. A declined requester may request again,
to the end of the queue; a removed one gets `409 tournament_entry_removed`.
Starting or cancelling the tournament declines every pending request. Each request leaves
the event's creator and co-organizers an in-app notice, and each decision
leaves one for the solo player, or the roster and the team's owner and
captains. Cancelling the event also emails pending requesters.

**Seeds and the bracket.** `PUT .../seeds` takes
`{ "entry_ids": ["<entry id>", ...] }`, every registered entry exactly once
(`422 invalid_seed_order` otherwise), in seed order, and answers with
`{ "entries": [...] }`. It works while registration is open or the tournament
is in progress (`409 tournament_locked` otherwise). `POST .../bracket` builds
a single-elimination bracket from the registered entries in seed order once
the tournament is in progress (`409 tournament_not_started` before) and
answers with `{ "matches": [...] }`; generating again replaces the bracket.
Both are for organizers (`403 not_event_organizer`), are refused with
`409 tournament_bracket_locked` once any match is live or has a score or a
result, and with `409 event_ended` once the event has ended. Each slot keeps
the seed it had when the bracket was generated, so reseeding changes the
bracket only when it is generated again. The bracket is
sized to the next power of two in the standard seed order (1 plays the
lowest seed, and the top seeds meet as late as possible), so the byes go to
the top seeds; a bye advances its entrant to the second round without a
match. `GET .../matches` returns `{ "matches": [...] }` with
`private, no-store`, following the event page's access as the entrant list
does. A match is

```text
{ "id", "round", "position",
  "entrants": [{ "entry_id", "seed", "player": { "public_id", "name" },
                 "team": { "id", "name", "slug" } }, null],
  "status": "upcoming", "scheduled_at", "scores": [2, 1],
  "winner_entry_id", "walkover", "next_match_id" }
```

An entrant slot is `null` until an earlier match decides it. First-round
positions with a bye have no match, so position numbers can skip.
`scheduled_at`, `scores`, `winner_entry_id`, `walkover`, and
`next_match_id` (none for the final) are omitted when not set, and
signed-out viewers get no `player`.

**Results.** `POST .../matches/:id/result` takes
`{ "winner_entry_id", "scores": [2, 1] }`, both sides' whole-number scores
(0 to 1,000,000) in slot order, or `{ "winner_entry_id", "walkover": true }`
with no scores for a no-show. It is for organizers (`403 not_event_organizer`)
and answers with the whole bracket as `{ "matches": [...] }`, because the
winner moves into their next match at once and the match becomes `complete`.
The final's result completes the tournament. Sending a result for a match that
has one corrects it; a new winner replaces the old one in the next match.
The result is official: entrants cannot enter their own. Results are not
refused once the event has ended. Errors:

- `400 invalid_request` for missing or out-of-range scores, scores on a
  walkover, or a draw
- `404 tournament_match_not_found` for a match not in the bracket
- `409 tournament_match_not_ready` while either entrant is still undecided
- `409 tournament_result_locked` for a correction once the winner's next
  match has a result
- `409 tournament_locked` for a cancelled tournament, or a completed one
  except to correct its final
- `422 invalid_match_result` for a winner who is not in the match or does not
  have the higher score

A member who leaves a team, or is removed from it, leaves its rosters for
tournaments that have not started. An organizer's removal leaves an in-app
notice for the solo player, or the roster and the team's owner and captains.
Cancelling the event emails every entrant, as it emails RSVPs. While an event has settings, `PATCH /events/:slug` returns
`409 tournament_event_type_required` for a change of type and
`422 tournament_game_not_on_event` when it drops the tournament's game, and
`POST /events/:slug/rsvp` returns `409 event_uses_registration` for any
response but `no` unless the tournament is cancelled. Cancelling the event cancels a tournament that has not
completed.

### Games

| Method | Path                     | Notes                                                    |
| ------ | ------------------------ | -------------------------------------------------------- |
| GET    | `/games`                 | Browse (public); active games only; `q` searches by name |
| GET    | `/games/:slug`           | One active game (public); `404 game_not_found` otherwise |
| GET    | `/games/:slug/cover`     | Stored cover image of an active game                     |
| GET    | `/games/igdb-search?q=`  | Auth; search IGDB from a game picker                     |
| GET    | `/igdb-covers/:image_id` | Small IGDB cover of a recent search result (public)      |
| GET    | `/popular-games`         | Games with the most upcoming public events (public)      |

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

`GET /popular-games` returns up to 8 active games ranked by how many public
events that have not ended list them, most first, then by name, as
`{ "games": [{ "id", "name", "slug", "cover_url"?, "upcoming_events" }] }`.
With `school=<slug>` it counts only the events that school hosts; an unknown
slug returns an empty list. A game with no such event is left out, so the list
can be empty. Events under way count, as they do on the events list, and
private and deleted events never count. The home page and the school page show
it as "Popular games", each game linking to the events list filtered by that
game (and school).

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

### Notifications & announcements

| Method | Path                             | Notes                                                                                 |
| ------ | -------------------------------- | ------------------------------------------------------------------------------------- |
| GET    | `/me/notifications`              | Auth; the inbox, newest first; `limit` 1–50 (default 20) and `after` cursor           |
| GET    | `/me/notifications/unread-count` | Auth; `{"unread"}`                                                                    |
| POST   | `/me/notifications/:id/read`     | Auth; marks one read and returns it; another person's is `404 notification_not_found` |
| POST   | `/me/notifications/read-all`     | Auth; marks every unread one read; `{"marked"}`                                       |
| GET    | `/announcements/active`          | **(planned)** Site-wide banner                                                        |

Inbox responses are `private, no-store`. `GET /me/notifications` returns `{"notifications": [...], "next_cursor"}`; `next_cursor` is empty on the last page, and a malformed one or an out-of-range `limit` is `400 invalid_cursor` or `400 invalid_limit`. Each notification has `id`, `type`, `title`, `body`, `created_at`, `read_at` once read (marking it again keeps the first time), and `event_slug` or `team_slug` while the event or team it is about is still listed. The site writes these types, each in the same transaction as the change it announces:

- `event.cancelled` to each active yes/maybe attendee when an event is cancelled, by its creator or because the creator deleted their account. The person cancelling gets none.
- `event.organizer_joined` to an event's creator when someone accepts a [co-organizer invite](#co-organizers).
- `tournament.entry_removed` to the solo player, or to the roster and the team's owner and captains, when an organizer removes a [tournament entry](#tournaments).
- `tournament.entry_requested` to an event's creator and co-organizers, other than the requester, for each request to join a tournament in approval mode.
- `tournament.entry_approved` and `tournament.entry_declined` to the same people as a removal when an organizer approves or declines a request; starting the tournament declines the requests still pending, with the same notice.
- `team.member_joined` to a team's owner when someone joins the team. Joining a team one already belongs to sends none.
- `team.ownership_transferred` to the member a team's owner makes the new owner.

Both team notices also queue an email to the same person, unless their account is deleted or suspended.

### Support & safety

| Method | Path               | Notes                                                      |
| ------ | ------------------ | ---------------------------------------------------------- |
| POST   | `/support-tickets` | Main site: anyone can submit (logged out OK); rate limited |

Reports are submitted through `POST /events/:slug/report` and
`POST /users/:public_id/report`.

### Admin API

All routes are under `/admin/v1`. They are served only when `ADMIN_ENABLED` is set, and only to the admin BFF: requests
must carry the admin proxy secret exactly once, an Admin Console session, the
Access identity the BFF verified for the request (`X-CGN-Admin-Access-Email`,
which must match the identity the session was issued to), a matching capability,
and CSRF protection on mutations. Request and response contracts,
capabilities, and step-up rules live in
[20 — Admin Console v1 engineering plan](./20-admin-console-v1-engineering-plan.md).

| Area                | Routes                                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Session             | `POST /auth/exchange`, `POST /auth/step-up`, `GET /session`, `POST /logout`                                                           |
| Reports and support | `GET`/`PATCH` `/reports` and `/support-tickets` (list, detail, update) plus `GET …/:id/audit`                                         |
| Queue counts        | `GET /report-counts` and `GET /support-ticket-counts`                                                                                 |
| Schools             | List, create, get, update, `deactivate`, `reactivate`, and delete under `/schools`, plus `GET /schools/:id/audit`                     |
| School logos        | `POST /schools/:id/logo` (multipart upload) and `DELETE /schools/:id/logo`                                                            |
| School admins       | `GET`/`POST /schools/:id/admin-grants`, `POST …/:grant_id/revoke`, and `GET …/:grant_id/audit`                                        |
| Clubs               | List, create, get, update, `links`, `hide`, `unhide`, `remove-member`, and `mark-checked` under `/clubs`, plus `GET /clubs/:id/audit` |
| Club claims         | `GET /club-claims`, `GET /club-claims/:id`, `POST …/:id/approve`, `POST …/:id/reject`, and `GET …/:id/audit`                          |
| Games               | List, get, update, and delete under `/games`, plus `GET /games/:id/audit`; admins never add games                                     |
| IGDB                | `POST /games/:id/refresh` and `GET /games/:id/cover`                                                                                  |
| Users               | List, get, `suspend`, `reactivate`, `PATCH /users/:id/trust-grants`, and `GET /users/:id/audit`                                       |
| Site admins         | `GET`/`POST /site-admin-grants`, `POST /site-admin-grants/:id/revoke`, and `GET /site-admin-grants/:id/audit`                         |
| System              | `GET /system`                                                                                                                         |
| Metrics             | `GET /metrics`                                                                                                                        |
| Audit log           | `GET /audit`                                                                                                                          |

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

`GET /metrics` needs `metrics.read` and returns
`{ "as_of", "active": { "day", "week", "month" }, "days": [{ "day", "active", "signups", "club_joins", "rsvps", "events_created", "teams_created" }], "schools": [{ "id", "name", "active" }] }`.
`as_of` is today's UTC date, and every day is a UTC date (`YYYY-MM-DD`).
`active` counts distinct accounts with a signed-in request on `as_of` and in
the 7 and 30 days ending on it, from `user_activity_days`, so today's count is
the day so far. `days` lists the 30 days ending on `as_of`, newest first, with
each day's active accounts and the records created that day: accounts
(including ones since deleted), club memberships in any role, event RSVPs,
events, and teams. Memberships, RSVPs, events, and teams are counted while
their rows exist, so leaving a club or deleting an account removes them from
past days. `schools` names up to 20 home schools by active accounts in the
30 days, most first. It counts accounts and never names one.

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

| Trigger                            | Email                                                                                                                                     |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Event RSVP (yes)                   | Details + ICS — from `events@campusgamingnetwork.com`                                                                                     |
| Event cancellation                 | Active yes/maybe RSVPs and tournament entrants; best effort, without ICS — from `events@campusgamingnetwork.com`                          |
| Signup verification                | Link — from `account@campusgamingnetwork.com`                                                                                             |
| Password reset                     | Link — from `account@campusgamingnetwork.com`                                                                                             |
| Email change                       | Confirmation link to the new address, and a notice to the old one — from `account@campusgamingnetwork.com`                                |
| Co-organizer invite                | Accept link — from `events@campusgamingnetwork.com`                                                                                       |
| Team member joined                 | To the team's owner, with a link to the team — from `notifications@campusgamingnetwork.com`                                               |
| Team ownership transferred         | To the new owner, with a link to the team — from `notifications@campusgamingnetwork.com`                                                  |
| Support / report follow-up (later) | From `support@campusgamingnetwork.com`                                                                                                    |
| Club editor invite                 | Accept link, to the invited address — from `notifications@campusgamingnetwork.com`                                                        |
| Club ownership offered             | To the member offered the club, with a link to the club page — from `notifications@campusgamingnetwork.com`                               |
| Club claim approved or rejected    | To the applicant, with a link to the club or to support; never the evidence or review note — from `notifications@campusgamingnetwork.com` |
| (Future) team invite links         | As needed                                                                                                                                 |

Every email renders through one layout (`internal/emaillayout`): the site's name in a navy header, a heading, the message, one main action as a blue button with its plain address beneath it, smaller notes, and a footer saying why the recipient got it. Styles are inline because mail clients drop style blocks; a dark color scheme is added for clients that honor `prefers-color-scheme`. There are no images or remote fonts, every value is HTML-escaped, and an action's address must be `http` or `https`. Each email also carries a plain-text version. Account emails explain the action and what to do if the recipient did not ask for it. The cancellation email links to the events list, since the cancelled event's page comes down a day later. `internal/emaillayout/testdata/full.html` pins the shared markup.

## Validation & safety

- BFF request and response shapes validated with Zod; Go remains authoritative
  for domain, security, and persistence rules
- Character limits enforced server-side (event description, bio, etc.)
- Basic blocked-language filter on names, bios, event/team text, club claim
  evidence and requested club names, reports, and support messages; reject
  matches before persistence
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
