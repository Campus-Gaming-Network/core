# 03 — Database

PostgreSQL is the system of record. Conventions first; then core tables. Exact column lists will evolve in migrations — this doc captures intent.

## Conventions

| Rule            | Detail                                                                                                                                                                                                                                          |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Primary keys    | **UUID** (`gen_random_uuid()`) for domain tables — decided in [11 — Implementation decisions](./11-implementation-decisions.md)                                                                                                                 |
| Timestamps      | Every table has `created_at`, `updated_at`, `deleted_at` (nullable)                                                                                                                                                                             |
| Soft deletes    | Default for user-facing rows; queries filter `deleted_at IS NULL` unless admin/history                                                                                                                                                          |
| Time storage    | Store instants in UTC (`timestamptz`); display in user timezone in app layer                                                                                                                                                                    |
| Money           | May list paid/off-site-payment events, but CGN does not process payment. Store only lightweight display fields such as `cost`, `payment_note`, and an optional `payment_url`; use integer cents + currency only if on-site payments ship later. |
| Slugs           | Unique URL keys: `schools.slug`; `events.slug` — events use `slugify(title)-` + **8** Base64URL chars of SHA-256(creatorId\|date\|title)                                                                                                        |
| Images          | Event banners use default placeholder for now; school `logo_url` comes later via Admin Console upload (PNG/JPG only; max 5 MB)                                                                                                                  |
| Idempotency     | `events`, `teams`, `reports`, and `support_tickets` have a nullable, unique `idempotency_key` UUID. A create request that repeats a key returns the existing row. Recurring occurrences leave it null; only the series root carries the key.    |
| Audit vs system | `audit_logs` holds domain change history and remains separate from system/ops logs.                                                                                                                                                             |
| Nightly backups | Required in production                                                                                                                                                                                                                          |

## Initial migration scope

Keep the first migration set scoped to shipped features. Create only the tables needed for auth/profile, home school and follows, schools seed, launch games, events, teams, reports/support tickets, and operational needs.

Do **not** create first-pass tables for tournament matches, user activity history, feature flags, site announcements, on-site payments, IGDB bulk-sync runs, or broader Admin Console-only workflows until those phases are actively being built. The operations foundation includes audit history and per-user notifications. Audit history is readable through capability-gated Admin Console API routes; notifications have no HTTP or UI surface yet.

## Core tables (logical)

### Identity & profile

```text
users
  id,                         -- UUID; internal only, the target of every foreign key
  public_id,                  -- 10 base58 characters, unique, generated on insert, never changes
  email, password_hash,
  email_verified_at,          -- set when user clicks verification email link
  verification_level,         -- basic (email verified) | verified (.edu) | staff_faculty
  name,                       -- single public name field
  bio, timezone,
  home_school_id,             -- selected during signup; user may follow additional schools
  account_status,             -- active | suspended | deleted
  age_confirmed_at,           -- signup checkbox: 18+
  show_in_lists,              -- boolean, default true; false hides the user from event, school, and team people lists
  created_at, updated_at, deleted_at
  -- profile URL: /users/:public_id; no usernames
  -- on delete account: scrub PII; name becomes "Deleted User"

user_social_links
  id, user_id,
  kind,                       -- url | discord
  label,
  url,                        -- set when kind is url, otherwise NULL
  username,                   -- set when kind is discord, otherwise NULL
  sort_order, ...

user_games
  user_id, game_id,           -- primary key; a game is in at most one of a user's lists
  list,                       -- favorite | like | want_to_play
  position,                   -- order within the list from 0; unique per list, checked at commit
  created_at
  -- favorites are capped at 5 by CHECK (list <> 'favorite' OR position < 5)
  -- a deleted game drops off the lists; account deletion removes the rows

user_majors  (later)
  id, user_id, major_name (or major_id FK if normalized)

user_school_follows
  user_id, school_id, created_at, ...

user_school_affiliations  (later)
  user_id, school_id, role_context (student|alumni|faculty|...), ...

school_admins
  id (stable grant ID), school_id, user_id, created_at, updated_at, deleted_at
  -- school-scoped role grant; soft-revocable and re-grantable; site admins assign it in the Admin Console
```

### Policy acceptance

```text
policy_documents
  id, document_type ('terms' | 'privacy'), version, effective_at,
  content_sha256,             -- SHA-256 of the published source file
  source_ref,                 -- repository path of that file
  created_at
  -- unique (document_type, version); a trigger refuses every UPDATE and DELETE
  -- the version in effect is the latest effective_at that is not in the future

user_policy_acceptances
  id, user_id, policy_document_id, accepted_at,
  source ('signup' | 'policy_update')
  -- unique (user_id, policy_document_id); a trigger refuses every UPDATE
  -- no IP address or user agent; rows go only when the user row is deleted
```

Publishing a new version is a new source file under `apps/web/src/policies`
plus a migration that inserts its row. Accounts created before a version was
published have no acceptance row for it.

### Sessions & account tokens

```text
auth_sessions
  id, user_id, token_hash, expires_at, last_seen_at, revoked_at, ...
  -- public-site sessions; only the SHA-256 token hash is stored
  -- last_seen_at is no longer maintained (CGN-012) and can be dropped later

user_activity_days
  user_id, day (UTC date); primary key (user_id, day)
  -- one row per account per day it made a signed-in API request, for active
  -- user counts and retention; kept 13 months, exported, deleted with the
  -- account

email_verification_tokens
  id, user_id, token_hash, expires_at, consumed_at, ...

password_reset_tokens
  id, user_id, token_hash, expires_at, consumed_at, ...
  -- a successful reset consumes the token and revokes the user's sessions.
  -- A signed-in password change revokes every session but the requesting
  -- one and consumes open reset tokens

email_change_tokens
  id, user_id, new_email, token_hash, expires_at, consumed_at, ...
  -- a signed-in person's pending email change; a newer request consumes older
  -- ones. Using one moves users.email to new_email and sets
  -- email_verified_at; it fails if another account took new_email since
```

### Schools & clubs

```text
schools
  id, unitid nullable (unique when present; College Scorecard/IPEDS),
  name, alias, short_name, slug (unique), logo_url,  -- later Admin Console upload (PNG/JPG ≤5 MB); placeholder until set
  city, state, zip, website_url,
  latitude, longitude,
  is_main_campus, num_branches, is_active,
  created_at, updated_at, deleted_at
  -- name NOT unique; slug unique with auto-increment suffix on collision
  -- catalog bootstrapped once from data/schools_seed.csv; Admin Console owns create/edit/delete after that
  -- unitid optional/unique when present; Admin Console-created schools may omit
  -- one-time seed imports ALL rows as is_active=true (main + branch); branch campuses use same UI/UX
  -- logo_url is later Admin Console-only (PNG/JPG ≤5 MB), not Scorecard; not uploadable from main site

clubs
  id, school_id (required), name, slug (unique),
  type (student_club|university_program),   -- neither implies endorsement
  summary, how_to_join,                     -- '' means the club has not said
  status (published|hidden),                -- hidden: absent everywhere, page 404
  confirmed_at nullable, confirmed_source nullable (club|cgn),  -- both or neither
  created_at, updated_at, deleted_at

club_games
  club_id, game_id

club_links
  id, club_id, type (website|discord|social), label, url (http/https only),
  position, created_at, updated_at
  -- information only; none is the way to join

club_slug_redirects
  old_slug (primary key), club_id, created_at
  -- a renamed club's earlier slugs, so old links still reach it; a slug is in
  -- clubs.slug or here, never both

club_members
  club_id, user_id (primary key together), role (owner|editor|member),
  created_at, updated_at
  -- a club with an owner is claimed; claims write owners, editor invites
  -- write editors, and joining on CGN writes members. On account deletion a club whose
  -- last owner leaves passes to its longest-serving active editor, then
  -- member, or returns to unclaimed

club_editor_invites
  id, club_id, invited_by_user_id nullable, email, token_hash (unique),
  expires_at, accepted_at nullable, accepted_by_user_id nullable,
  revoked_at nullable, created_at, updated_at
  -- one pending invite per club and address; only the token's hash is stored

club_ownership_offers
  club_id (primary key), from_user_id, to_user_id, created_at
  -- at most one offer per club; nothing changes until the recipient accepts

club_confirmation_reminders
  club_id (primary key), confirmed_at, sent_at
  -- the confirmation a claimed club's owners were last reminded about; a
  -- club is reminded again only once a newer confirmation lapses

club_claims
  id, club_id nullable, school_id, requested_name nullable,
  requested_type nullable (student_club|university_program),
  applicant_user_id, evidence_text, evidence_url ('' or http/https),
  status (pending|approved|rejected), reviewer_user_id nullable,
  review_note nullable, reviewed_at nullable, created_at, updated_at
  -- a claim names club_id; a request names requested_name and requested_type,
  -- and approving it creates the club and sets club_id
  -- one pending claim per user per club, and one pending request per user per
  -- name at a school; a rejection needs a review note
  -- evidence, review_note, and the applicant stay out of public responses;
  -- account deletion removes the applicant's claims (decisions stay audited)
```

### Teams

```text
teams
  id, name, owner_user_id,
  password_hash,             -- join via shared URL + password (no invite tokens yet)
  club_id nullable,          -- when assigned to a school club (Varsity, JV, ...)
  school_id nullable,        -- sponsored / school-linked without club
  ...

team_members
  team_id, user_id, role (owner|captain|member), ...

team_games
  team_id, game_id
```

### Events

```text
events
  id, title, slug (unique; slugify(title) + 8-char Base64URL(SHA-256(creatorId|createdDate|title))),
  description, banner_url nullable,  -- null / default placeholder; custom uploads later
  visibility (public|unlisted|private),
  password_hash nullable,    -- required when private; share URL + password manually
  capacity nullable,         -- max RSVP yes count only; when full, block new yes (no waitlist yet)
  format (online|in_person),
  event_type nullable (game_night|lan|tournament|watch_party|tryout|meeting|workshop|other),
                              -- kind of event; null only on events created before the column.
                              -- 'tournament' is a label, not a tournament record
  audience nullable (open|collegiate|campus|members),
                              -- who the event is for; null only on events created before the column
  host_team_id nullable,      -- the hosting team; null when the organizer runs it alone.
                              -- checked against the organizer's team role only when chosen
  host_club_id nullable,      -- the hosting club; its owners and editors may edit and cancel.
                              -- the API keeps host_school_id equal to the club's school;
                              -- CHECK: at most one of host_team_id and host_club_id
  cost (free|paid|unspecified) default unspecified,
                              -- unspecified = the organizer did not say; never treated as free.
                              -- Replaced is_paid: true became paid, everything else unspecified
  payment_note nullable, payment_url nullable,  -- shown for paid events only
                              -- organizer handles any payment off-site; no CGN checkout/payment records
  location_address, location_lat, location_lng,
  starts_at, ends_at, registration_closes_at,
  recurrence_rule nullable,       -- weekly | biweekly | monthly
  recurrence_until nullable,      -- inclusive UTC end date; max one year from start
  recurrence_parent_id nullable,   -- generated occurrence's root event
  revision default 0,             -- a trigger raises it when a field the calendar file
                                  -- shows changes, cancellation included; the file's SEQUENCE
  created_by_user_id, school_id nullable,
  badge_eligible boolean or derived,
  created_at, updated_at, deleted_at

event_organizers
  event_id, user_id, role (creator|organizer), ...

event_organizer_invites
  id, event_id, invited_by_user_id, email, token_hash (unique; raw token only
  in the email), expires_at, accepted_at, accepted_by_user_id, revoked_at, ...
  -- one pending invite per (event_id, email); swept a day after it ends

event_games
  event_id, game_id

event_rsvps
  event_id, user_id, response (yes|no|maybe), ...

event_interests
  event_id, user_id, created_at, ...
  -- favorite/bookmark; independent of RSVP

event_private_unlocks
  id, event_id, token_hash, expires_at, ...
  -- 24-hour unlock grants for private events; archived when the password or visibility changes
```

### Tournaments

`tournaments` (`000045`), `tournament_entries`, and `tournament_entry_players`
(`000046`) are migrated; `tournament_matches` is planned, and its phase's issue
sets the final columns.
[02 — Domain model](./02-domain-model.md#tournament) owns the fields and rules.

```text
tournaments
  id, event_id (unique, references events), game_id,
  entry_type (solo|team), team_size nullable (2-20, team only),
  substitutes (0 to team_size, team only), entrant_cap nullable (2-512),
  registration_closes_at nullable (NULL = the event's start),
  format (single_elimination|round_robin|swiss|double_elimination),
  rules, prizes ('' when empty),
  status (draft|registration_open|in_progress|completed|cancelled),
  created_at, updated_at
  -- planned: format options, bracket_url

tournament_entries
  id, tournament_id, user_id nullable, team_id nullable (exactly one set),
  registered_by_user_id, status (registered|withdrawn|removed), seed nullable,
  registered_at, created_at, updated_at
  -- unique (tournament_id, user_id) and (tournament_id, team_id): one row per
  -- entrant, reused when a withdrawn entrant registers again

tournament_entry_players
  entry_id, tournament_id, user_id, created_at  -- an active team entry's roster
  -- unique (tournament_id, user_id); rows are deleted when the entry is
  -- withdrawn or removed, and a trigger deletes them when the player leaves
  -- the team before the tournament starts

tournament_matches
  id, tournament_id, bracket (upper|lower|grand_final), round, position,
  entry slots (nullable; a bye or not yet decided), next match for the
  winner (and loser), scheduled_at nullable, status, scores, winner, walkover
```

### Games

```text
games
  id, igdb_id nullable unique, name, slug, cover_url, is_active, user_submitted, last_synced_at nullable, ...
  -- end users cannot edit a game; they can add one by picking it from IGDB search or typing its name
  -- a game a user picks from IGDB search is imported active; site admins can hide it later
  -- user_submitted marks a typed name: inactive (not in the picker) but attachable to events and teams
  -- events and teams accept a game that is active or user_submitted, and never a deleted one
  -- igdb_id is null for a typed game or one added by hand before admins stopped adding games
  -- last_synced_at is set by import and refresh; refresh never overwrites name or slug
  -- inactive games leave the public picker but stay on events/teams that already use them
  -- cover_url is an admin-entered URL; a stored cover in game_covers takes its place in API responses

game_covers
  game_id pk -> games, content_type (image/jpeg | image/png | image/webp),
  bytes bytea (1 byte to 100 KB), source_image_id, etag, fetched_at
  -- the IGDB cover, downloaded by the API at import and replaced by refresh when IGDB's image changes
  -- etag is a hash of the bytes; list queries never select bytes

igdb_search_cache
  query pk (lowercased, single-spaced), results jsonb, fetched_at
  -- IGDB search results, reused for 24 hours by the user search
  -- expired rows are deleted when a new search is stored
  -- a GIN index on results (migration 000029) lets GET /igdb-covers/:image_id check that a cached search returned an image ID
```

**Catalog source:** migration `000020` removed the six hand-made launch games
that `000003` seeded, along with their event and team links. The seed command
imports a starter set from IGDB when credentials are set (`StarterGameSlugs` in
`apps/api/internal/games/igdb.go`); after that the catalog grows as users pick
games. Slugs come from IGDB, with a numeric suffix when one is
taken. A typed game's slug is made from its name, and typing a name whose slug
exists reuses that game.

### Trust, notify, flags, announcements

```text
reports
  id, reporter_user_id, target_type, target_id, reason, status,
  assigned_to_user_id nullable, resolution_note, retention_started_at nullable, ...

support_tickets
  id, submitter_user_id nullable, contact_email, name, subject, message, status,
  assigned_to_user_id nullable, resolution_note, submitter_deleted_at nullable,
  retention_started_at nullable, ...
  -- anyone can submit (logged out OK); viewed/managed in the Admin Console

notifications
  id, user_id, type, title, body,
  entity_type nullable, entity_id nullable, payload jsonb, read_at, created_at
  -- repository primitives exist; authenticated HTTP/UI surfaces are later

feature_flags  (later)
  id, key, description, enabled_globally, ...

feature_flag_targets  (later)
  flag_id, target_type (user|school|event|team), target_id, enabled, ...

site_announcements  (later)
  id, message, starts_at, ends_at, is_active, ...
```

### Audit & activity

```text
audit_logs
  id, actor_user_id nullable, action,
  entity_type, entity_id,
  before_json, after_json, metadata jsonb,
  created_at
  -- append-oriented domain history; queue mutations write before/after state
  -- shared by school, event, team, club, etc. as those workflows adopt it
  -- events write one row per change with entity_type 'event'; the event
  -- activity log reads them (02 — Domain model, Event activity log)
  -- indexed by (created_at DESC, id DESC) for the Admin Console audit log

email_outbox
  id, kind, recipient, payload jsonb, idempotency_key, attempts, next_attempt_at,
  locked_at, locked_by, delivered_at, failed_at, provider_message_id, last_error, ...
  -- durable delivery intent written in the same transaction as the domain change;
  -- the payload is cleared once delivery succeeds or fails permanently
  -- last_error keeps the provider's full response; the delivery-failure log line
  -- carries only its HTTP status and error name

activity_logs  (optional separate from audit)
  id, user_id, action, metadata jsonb, created_at
  -- "users can see their activities logged"
```

### Admin access

```text
site_role_grants
  id, user_id, role (site_admin), granted_by_user_id nullable, grant_reason, granted_at,
  revoked_at, revoked_by_user_id, revoke_reason
  -- append-only grant history; at most one active grant per user and role

admin_sessions
  id, user_id, grant_id, token_hash, csrf_token_hash, authn_method, access_issuer,
  access_subject, access_email, authenticated_at, step_up_at, last_seen_at,
  idle_expires_at, absolute_expires_at, revoked_at, revocation_reason, created_at
  -- isolated from public-site sessions; bound to one active site-role grant

admin_security_events
  id, event_type, outcome, actor_user_id, admin_session_id, request_id,
  network_identifier_hash, metadata jsonb, occurred_at
  -- bounded security telemetry, separate from audit_logs domain history

school_logo_objects
  id, school_id, object_key (unique), state (pending | current | retired),
  created_at, updated_at
  -- every stored R2 logo object; at most one current per school. Retired and
  -- abandoned pending objects are deleted from R2, then their rows removed
```

If activity and audit can share one table with a clear `kind` discriminator, prefer one table — but **system/ops logs stay out of the database audit table** (or in a separate store).

## Indexes (minimum intent)

- Unique: `users.email`, `schools.slug`, `events.slug`, `tournaments.event_id`, `games.igdb_id`
- RSVP uniqueness: `(event_id, user_id)` where not deleted
- Interest uniqueness: `(event_id, user_id)`
- Follow uniqueness: `(user_id, school_id)`
- School member list: `users (home_school_id, lower(name), id)`, partial to active, email-verified, listed accounts (`users_home_school_listing_idx`)
- Common filters: `events.starts_at`, `events.visibility`, `events.deleted_at`, game FKs, geo later if needed
- Audit history: `(entity_type, entity_id, created_at DESC)`
- Foreign keys: every foreign key's referencing columns lead some index, because Postgres does not create one and a cascade or restrict check would otherwise scan the referencing table. A new foreign key ships with its index in the same migration; `TestSchemaInvariants` fails otherwise. Do not recreate indexes dropped on purpose (for example the school trigram indexes removed in `000007`).
- Text bounds: the free-text columns users type into carry CHECK constraints that match the API validators (`000041`): `events` title (non-empty only), description, location, address, online URL, and payment note; `teams` name and description; `users` name and bio; `user_social_links` label and URL; `reports.reason`; and `support_tickets` name, subject, and message. The database counts characters and the API counts bytes, so the database never rejects what the API accepts. A new free-text column gets a bound in the same migration as the column.

## Search (Postgres first)

Prefer Postgres over Elasticsearch (or similar) until scale demands it.

| Use case                     | Approach                                                                                                 |
| ---------------------------- | -------------------------------------------------------------------------------------------------------- |
| School search / browse       | `pg_trgm` on `name` / `alias` + filters (state, etc.); optional `tsvector`                               |
| Events / tournaments by game | Join `event_games` (a tournament is found through its event); filter `visibility = public` for discovery |
| Text filters                 | Indexed columns: game, starts_at, format, school_id, visibility                                          |

Do not list `unlisted` or `private` events in discovery search. Unlisted is reachable by slug URL; private also requires password verification.

## Soft delete & anonymization

| Case                 | Behavior                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Event cancelled      | Soft delete; public URL shows “no longer exists”; best-effort cancellation email to active yes/maybe RSVPs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| User deletes account | Scrub the account row; delete personal follows, profile game lists, memberships, RSVPs, interests, tokens, and notifications; revoke school-admin and site-admin grants while keeping their history; unassign every report and support ticket assigned to the account, writing one audit entry per item; detach submitted support tickets and scrub direct contact fields on terminal tickets; transfer created events to the longest-tenured active co-organizer or soft-cancel them; keep required domain FKs and audit history. Free-text retention and final purge policy remain tracked in doc 16. |
| Hard delete          | Avoid for domain entities unless legally required                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

## Backups

- Railway PostgreSQL backups must be enabled/verified before public launch
- Document restore drill in ops notes when infra exists

## Migrations

- Versioned SQL migrations live in `db/migrations` and are applied by the Go migrator
- First migrations stay scoped to shipped features; defer schema for tournament matches, feature flags, site announcements, on-site payments, IGDB sync, and Admin Console-only workflows.
- In Railway production, run the Go migrator as a pre-deploy command or dedicated migration service/job before the API serves traffic
- Never rely on manual prod SQL for schema changes
- The migrator runs each file in one transaction, so `CREATE INDEX CONCURRENTLY` is not available; indexes build under a write lock, which is acceptable at current table sizes
- `TestSchemaInvariants` (needs `API_DATABASE_URL`) fails on any foreign key without a leading index, any table without a primary key, and any `timestamp without time zone` column unless allowlisted in the test with a reason
- The Admin Console exists so operators are not editing rows by hand for routine ACL/school work
