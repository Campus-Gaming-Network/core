# 03 — Database

PostgreSQL is the system of record. Conventions first; then core tables. Exact column lists will evolve in migrations — this doc captures intent.

## Conventions

| Rule | Detail |
|------|--------|
| Primary keys | `uuid` (preferred) or `bigint` — pick one and stay consistent |
| Timestamps | Every table has `created_at`, `updated_at`, `deleted_at` (nullable) |
| Soft deletes | Default for user-facing rows; queries filter `deleted_at IS NULL` unless admin/history |
| Time storage | Store instants in UTC (`timestamptz`); display in user timezone in app layer |
| Money | MVP may list paid/off-site-payment events, but CGN does not process payment. Store only lightweight display fields such as `is_paid`, `payment_note`, and optional `payment_url`; use integer cents + currency only if on-site payments ship later. |
| Slugs | Unique URL keys: `schools.slug`; `events.slug` — events use `slugify(title)-` + **8** Base64URL chars of SHA-256(creatorId\|date\|title) |
| Images | Event banners use default placeholder in MVP; school `logo_url` comes later via CRM/admin upload (PNG/JPG only; max 500 MB) |
| Audit vs system | `audit_logs` = domain history; system/ops logs are not this table |
| Nightly backups | Required in production |

## MVP migration scope

Keep the first migration set MVP-only. Create only the tables needed for auth/profile, home school and follows, schools seed, MVP games, events, teams, reports/support tickets, notifications, audit/activity, and operational needs.

Do **not** create first-pass tables for clubs, tournaments, feature flags, site announcements, on-site payments, IGDB sync, or CRM/admin-only workflows until those phases are actively being built.

## Core tables (logical)

### Identity & profile

```text
users
  id, email, password_hash,
  email_verified_at,          -- set when user clicks verification email link
  verification_level,         -- basic (email verified) | verified (.edu) | staff_faculty
  name,                       -- single public name field
  bio, timezone,
  home_school_id,             -- selected during signup; user may follow additional schools
  expected_graduation_on, degree_level, account_status,
  age_confirmed_at,           -- signup checkbox: 18+
  created_at, updated_at, deleted_at
  -- profile URL: /users/:id (database id); no usernames
  -- on delete account: scrub PII; name becomes "Deleted User"

user_social_links
  id, user_id, label, url, ...

user_majors
  id, user_id, major_name (or major_id FK if normalized)

user_school_follows
  user_id, school_id, created_at, ...

user_school_affiliations
  user_id, school_id, role_context (student|alumni|faculty|...), ...
```

### Schools & clubs

```text
schools
  id, unitid nullable (unique when present; College Scorecard/IPEDS),
  name, alias, slug (unique), logo_url,  -- post-MVP CRM/admin upload (PNG/JPG ≤500 MB); placeholder until set
  city, state, zip, website_url,
  latitude, longitude,
  is_main_campus, num_branches, is_active,
  created_at, updated_at, deleted_at
  -- name NOT unique; slug unique with auto-increment suffix on collision
  -- catalog bootstrapped once from data/schools_seed.csv; admin tooling / CRM owns create/edit/delete after that
  -- unitid optional/unique when present; admin/CRM-created schools may omit
  -- one-time seed imports ALL rows as is_active=true (main + branch); branch campuses use same UI/UX
  -- logo_url is post-MVP CRM/admin-only (PNG/JPG ≤500 MB), not Scorecard; not uploadable from main site

school_admins
  school_id, user_id, created_at, ...
  -- school admins cannot remove other school admins (enforce in app)

clubs
  id, school_id (required), name, is_official, status (pending|approved|...), ...
  -- clubs exist only under a school; school admins manage

club_officers
  club_id, user_id, ...

club_games
  club_id, game_id
```

### Teams

```text
teams
  id, name, owner_user_id,
  password_hash,             -- join via shared URL + password (no invite tokens in MVP)
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
  description, banner_url nullable,  -- MVP: null / default placeholder; custom uploads later
  visibility (public|unlisted|private),
  password_hash nullable,    -- required when private; share URL + password manually
  capacity nullable,         -- max RSVP yes count only; when full, block new yes (no waitlist in MVP)
  format (online|in_person),
  is_paid boolean default false, payment_note nullable, payment_url nullable,
                              -- MVP: organizer handles any payment off-site; no CGN checkout/payment records
  location_address, location_lat, location_lng,
  starts_at, ends_at, registration_closes_at,
  recurrence_rule nullable,
  created_by_user_id, school_id nullable,
  badge_eligible boolean or derived,
  created_at, updated_at, deleted_at

event_organizers
  event_id, user_id, ...

event_games
  event_id, game_id

event_rsvps
  event_id, user_id, response (yes|no|maybe), ...

event_interests
  event_id, user_id, created_at, ...
  -- favorite/bookmark; independent of RSVP
```

### Tournaments

```text
tournaments
  id, title, slug (unique; name + small hash with date/other info),
  type (individual|team), capacity nullable,
  event_id nullable, ...
  -- capacity full => block new registrations; no waitlist in MVP

tournament_games
  tournament_id, game_id

tournament_registrations
  tournament_id, user_id nullable, team_id nullable, registered_by_user_id, ...
```

### Games

```text
games
  id, igdb_id nullable, name, slug, cover_url, raw_payload jsonb?, last_synced_at, ...
  -- end users cannot edit; MVP seeded with 6 launch games; IGDB/CRM enrichment later
```

**MVP game seed:** Rocket League, Valorant, League of Legends, Overwatch 2, Super Smash Bros. Ultimate, CSGO.

### Trust, notify, flags, announcements

```text
reports
  id, reporter_user_id, target_type, target_id, reason, status, ...

support_tickets
  id, submitter_user_id nullable, contact_email, name, subject, message, status, ...
  -- anyone can submit (logged out OK); viewed/managed in post-MVP CRM/admin tooling

notifications
  id, user_id, type, payload jsonb, read_at, ...

feature_flags
  id, key, description, enabled_globally, ...

feature_flag_targets
  flag_id, target_type (user|school|event|team), target_id, enabled, ...

site_announcements
  id, message, starts_at, ends_at, is_active, ...
```

### Audit & activity

```text
audit_logs
  id, actor_user_id nullable, action,
  entity_type, entity_id,
  before_json, after_json, metadata jsonb,
  created_at
  -- shared by school, event, team, club, etc.

activity_logs  (optional separate from audit)
  id, user_id, action, metadata jsonb, created_at
  -- "users can see their activities logged"
```

If activity and audit can share one table with a clear `kind` discriminator, prefer one table — but **system/ops logs stay out of the database audit table** (or in a separate store).

## Indexes (minimum intent)

- Unique: `users.email`, `schools.slug`, `events.slug`, `tournaments.slug`, `games.igdb_id`
- RSVP uniqueness: `(event_id, user_id)` where not deleted
- Interest uniqueness: `(event_id, user_id)`
- Follow uniqueness: `(user_id, school_id)`
- Common filters: `events.starts_at`, `events.visibility`, `events.deleted_at`, game FKs, geo later if needed
- Audit: `(entity_type, entity_id, created_at DESC)`

## Search (Postgres first)

Prefer Postgres over Elasticsearch (or similar) until scale demands it.

| Use case | Approach |
|----------|----------|
| School search / browse | `pg_trgm` on `name` / `alias` + filters (state, etc.); optional `tsvector` |
| Events / tournaments by game | Join `event_games` / `tournament_games`; filter `visibility = public` for discovery |
| Text filters | Indexed columns: game, starts_at, format, school_id, visibility |

Do not list `unlisted` or `private` events in discovery search. Unlisted is reachable by slug URL; private also requires password verification.

## Soft delete & anonymization

| Case | Behavior |
|------|----------|
| Event deleted | Soft delete; public URL shows “no longer exists” |
| User deletes account | Scrub PII; `name = 'Deleted User'`; keep FKs for history |
| Hard delete | Avoid for domain entities unless legally required |

## Backups

- Nightly automated backups in production
- Document restore drill in ops notes when infra exists

## Migrations

- Versioned migrations (tool TBD: golang-migrate, Atlas, etc.)
- First migrations stay MVP-only; defer schema for clubs, tournaments, feature flags, site announcements, on-site payments, IGDB sync, and CRM/admin-only workflows.
- Never rely on manual prod SQL for schema changes
- CRM/admin tooling exists later so operators are not editing rows by hand for routine ACL/school work
