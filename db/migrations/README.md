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
Do not add clubs, tournaments, feature flags, site announcements, on-site
payment tables, IGDB sync tables, or Admin Console-only workflow tables until those
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
