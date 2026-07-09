# Database migrations

Versioned SQL migrations live here.

Phase 0 intentionally creates only foundation-level database setup. Do not add clubs, tournaments, feature flags, site announcements, on-site payment tables, IGDB sync tables, or CRM/admin-only workflow tables until those phases are active.

Docker Compose mounts `000001_foundation.up.sql` into the Postgres init directory for fresh local databases. A real migration runner can be added before Phase 1 schema work begins.
