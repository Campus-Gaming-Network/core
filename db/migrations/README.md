# Database migrations

Versioned SQL migrations live here.

Phase 0 intentionally creates only foundation-level database setup. Phase 1A
adds the identity and read-catalog foundation in `000002_phase1_identity_catalog.up.sql`.
Phase 3.5 adds recurring event fields and occurrence indexing in
`000008_recurring_events.up.sql`; occurrences remain normal event rows.
The same phase adds school-scoped role grants in `000009_trust_roles.up.sql`.
Do not add clubs, tournaments, feature flags, site announcements, on-site
payment tables, IGDB sync tables, or CRM/admin-only workflow tables until those
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
