# 11 — Implementation decisions

Small, concrete engineering choices for Phase 0 and early MVP implementation. These decisions keep the scaffold boring, explicit, and easy to change before real users.

## Phase 0 decisions

| Area | Decision |
|------|----------|
| Repo layout | Monorepo with `apps/web`, `apps/api`, `db/migrations`, `docs`, `data`, and `scripts` |
| Node.js | Node 24 for local development, CI, and Docker web runtime |
| Main site | Next.js 16 + TypeScript App Router |
| Web linting | Oxlint for fast JavaScript/TypeScript linting; TypeScript remains the type-safety gate. Package versions are pinned exactly and upgraded intentionally. |
| npm package versions | Pin exact npm package versions. Do not use `^`, `~`, `latest`, or broad semver ranges when adding or updating packages. |
| API | Go REST/JSON HTTP service |
| Go version | Go 1.21 for local compatibility |
| Go dependencies | Standard library first; add dependencies only when Phase 1 needs them |
| Frontend auth | Opaque server-side session cookies; no browser JWT auth |
| Auth session backing | Still open: Postgres vs Redis before auth implementation |
| Primary keys | Use UUIDs for domain tables unless a later migration ADR overrides this |
| Migrations | Keep first migrations MVP-only; use timestamped/versioned SQL files in `db/migrations` |
| Database readiness | Phase 0 `/ready` checks Postgres network reachability; real SQL checks arrive with the DB driver |
| CRM | Skipped for MVP; CRM/admin app remains post-MVP |
| Branch campuses | Same UI/UX as other schools |
| Paid events | MVP supports off-site-payment listings only; no CGN payment processing |

## Initial folder responsibilities

```text
apps/web       Main user-facing site and BFF route handlers
apps/api       Go API that owns validation, authorization, side effects, and persistence
db/migrations  Versioned SQL migrations
docs           Product, architecture, API, permissions, and delivery docs
data           Tracked slim seed data only
scripts        Local/dev utilities
```

## Deferred until Phase 1+

- Real auth/session implementation
- SQL driver and query layer
- User/profile/school/event/team tables
- School seed import command
- Resend integration
- Sentry SDK integration
- CRM/admin app
- TypeScript 7 adoption; revisit when Next.js officially supports it
