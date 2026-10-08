# Database migrations

Versioned SQL migrations live here.

Phase 0 intentionally creates only foundation-level database setup. Phase 1A
adds the identity and read-catalog foundation in `000002_phase1_identity_catalog.up.sql`.
Phase 3.5 adds recurring event fields and occurrence indexing in
`000008_recurring_events.up.sql`; occurrences remain normal event rows.
The same phase adds school-scoped role grants in `000009_trust_roles.up.sql`.
The operations foundation in `000010_operations_foundation.up.sql` adds queue
assignment and terminal-retention fields, domain audit history, and per-user
notifications; site-admin authorization, purge/hold jobs, and Admin Console HTTP/UI
surfaces remain separate work.
The Admin Console security foundation starts with revocable site-wide grants in
`000012_site_role_grants.up.sql` and isolated, grant-bound admin sessions in
`000013_admin_sessions.up.sql`. Migration
`000014_admin_security_events.up.sql` adds append-oriented Admin Console
security events and queryable admin-session/request correlation to domain audit
history. These tables do not expose an HTTP surface by
themselves; Cloudflare Access validation, admin-only proxy trust, session
exchange, and capability middleware must land before any operations route is
registered.
Migration `000015_admin_catalog_commands.up.sql` adds game activation, stable
school-grant IDs, admin query indexes, strictly advancing record versions, and
row-locking guards against references to soft-deleted catalog records. Existing
school-grant composite keys and history are retained. Apply it before deploying
the AC-009 API, since public game queries also use the new activation column.
Migration `000016_create_idempotency_keys.up.sql` adds nullable, unique
`idempotency_key` columns to events, teams, reports, and support tickets so a
repeated create request returns the original row.
Migration `000017_school_logo_objects.up.sql` tracks every stored school-logo
object as pending, current, or retired so the API can delete objects that a
failed or replaced upload leaves behind.
Migration `000018_user_list_visibility.up.sql` adds `users.show_in_lists`
(default true), the opt-out from the event, school, and team people lists, and
the partial index that serves the school member list. Apply it before deploying
the API that reads or writes the column.
Migration `000019_policy_acceptance.up.sql` adds the immutable
`policy_documents` table, the append-only `user_policy_acceptances` table, and
the first published Terms and Privacy versions. Apply it before deploying the
API that requires a policy claim at signup. A later version is published by a
new migration that inserts a row; never edit a published row or its source
file.
Migration `000020_igdb_game_import.up.sql` adds `games.last_synced_at` and the
`game_covers` table, which holds each imported game's cover as `bytea`. It also
deletes the six launch games seeded by `000003`, with the event and team links
that point at them; games are imported from IGDB from here on. Apply it before
deploying the API that reads covers.
Migration `000021_user_game_picker.up.sql` adds `games.user_submitted`, which
marks a game a user typed in, and the `igdb_search_cache` table, which holds
IGDB search results for 24 hours. Apply it before deploying the API that
accepts picked or typed games.
Migration `000022_event_audience.up.sql` adds the nullable `events.audience`
column (`open`, `collegiate`, `campus`, `members`). Existing events keep
`NULL`. Apply it before deploying the API that reads or writes the column.
Migration `000023_event_type.up.sql` adds the nullable `events.event_type`
column. Existing events keep `NULL`. Apply it before deploying the API that
reads or writes the column.
Do not add clubs, tournaments, feature flags, site announcements, on-site
payment tables, IGDB bulk-sync tables, or Admin Console-only workflow tables until those
phases are active.

The Go migration runner is `apps/api/cmd/migrate`. It creates
`schema_migrations`, applies pending files in numeric order, and records each
successful migration transactionally. Run it locally with:

```bash
cd apps/api
go run ./cmd/migrate -dir ../../db/migrations
```

Docker Compose runs the same command in a one-shot `migrate` service before the
`seed` service and API start. The seed service imports
`data/schools_seed.csv` only when the catalog is empty. Migrations are not
mounted into Postgres's init directory, so the same workflow works with
existing database volumes as well as fresh ones.

To run the one-time school bootstrap directly:

```bash
cd apps/api
go run ./cmd/seed -csv ../../data/schools_seed.csv
```
