# Campus Gaming Network — Documentation

Central hub for collegiate gamers: find events, teams, and school gaming info across the United States.

**Sites:** [campusgamingnetwork.com](https://campusgamingnetwork.com) (ma yet) · [crm.campusgamingnetwork.com](https://crm.campusgamingnetwork.com) (later CRM/admin app)

These docs are the source of truth for product intent, domain rules, architecture, and delivery order. Use them when implementing features or asking an LLM to generate code.

## Reading order

| Doc | Purpose |
|-----|---------|
| [00 — Current state](./00-current-state.md) | Quick re-entry point: where we are, what is next, and what is blocked |
| [01 — Product](./01-product.md) | Vision, principles, personas, feature inventory, launch scope |
| [02 — Domain model](./02-domain-model.md) | Entities, relationships, and business rules |
| [03 — Database](./03-database.md) | Schema conventions, tables, soft deletes, audit/system logs |
| [04 — API](./04-api.md) | BFF pattern, Go services, endpoint surface |
| [05 — Roadmap](./05-roadmap.md) | Phased delivery from first release → production → later |
| [06 — Architecture](./06-architecture.md) | Stack, hosting, Docker, observability, security |
| [07 — Permissions](./07-permissions.md) | Roles, ACLs, impersonation, CRM |
| [08 — Open questions](./08-open-questions.md) | Unresolved product/tech decisions |
| [09 — School data](./09-school-data.md) | One-time College Scorecard seed → later admin/CRM owns catalog after |
| [10 — Delivery status](./10-delivery-status.md) | Status tracker and remaining Now/Next/Later work |
| [11 — Implementation decisions](./11-implementation-decisions.md) | Concrete engineering choices for Phase 0 and early implementation work |
| [12 — Phase 1 plan](./12-phase-1-plan.md) | Reviewable Phase 1A–1D breakdown for auth, profiles, schools, and games |
| [13 — Deployment plan](./13-deployment-plan.md) | Railway deploy target, env vars, migrations, backups, DNS, and launch smoke test |
| [14 — Architecture diagrams](./14-architecture-diagrams.md) | Mermaid overviews of the frontend, backend, and complete system |
| [15 — Pass v0 quality checklist](./15-pass-v0-checklist.md) | Regression checklist for signup → event → RSVP → team → dashboard |
| [16 — Legal and data-lifecycle plan](./16-legal-and-data-lifecycle-plan.md) | Pre-launch policy blockers, retention targets, account deletion, and operations follow-up |
| [17 — Codebase review action plan](./17-codebase-review-action-plan.md) | Prioritized engineering backlog from the 2026-09-05 architecture, correctness, reliability, and product-readiness review |

## How to use with AI / LLMs

1. Point the model at this folder (or the specific doc for the task).
2. Prefer implementing against **domain rules** and **roadmap phase**, not inventing new entities.
3. When a decision is listed in [08 — Open questions](./08-open-questions.md), ask before coding.
4. Keep changes simple: single developer, cost-conscious, server-first.

## Conventions

- **US launch only** — international schools are out of scope at launch.
- **Not yet scheduled** — Sentry/error monitoring, CRM/admin app, clubs, tournaments, on-site payments, usernames, waitlists, invite links, feature flags, near-you, custom event banners.
- **Events ≠ tournaments** — events are things you attend; tournaments (later) are competitions you enter.
- **Clubs ≠ teams** — clubs (later) belong to schools; teams are supported now (public pages; password to join).
- **Event visibility** — `public` · `unlisted` · `private` (blurred/gated + password modal).
- **RSVP vs interested** — RSVP = yes/no/maybe; interested = favorite (separate).
- **Capacity** — optional; counts **RSVP yes only**; full blocks new yes; no waitlist yet.
- **Names** — single `name` field; profile at `/users/:id`.
- **Schools** — user selects one home school on signup, may follow more schools later; import all 6,243 seed rows (1,300 branches) as active; branch campuses use the same UI/UX as other schools; `unitid` optional.
- **Paid events** — allowed as informational/off-site payment only; organizers handle payment outside the product.
- **Launch games** — Rocket League, Valorant, League of Legends, Overwatch 2, Super Smash Bros. Ultimate, CSGO.
- **Images** — event banners = default placeholder for now; school logos come later via CRM/admin app uploads (PNG/JPG only, max 500 MB).
- **Event slugs** — `slugify(title)-` + 8-char Base64URL(SHA-256(…)).
- **Recurring events** — weekly, biweekly, or monthly; max one year; occurrences are independent event rows with independent RSVPs and cancellation.
- **Cancellation email** — best-effort email to active yes/maybe RSVPs after soft cancellation; delivery failure does not undo cancellation.
- **Trust indicators** — public profiles expose verified-student, staff/faculty, and active school-admin indicators; event details expose applicable organizer indicators.
- **Content filtering** — reject a small word-boundary blocked-term list in user-authored names, bios, event/team text, reports, and support messages before persistence.
- **Page metadata** — every route sets its own title/description/Open Graph tags; authenticated, token, private, and unlisted routes are `noindex`. A locked private event exposes only a generic title.
- **Not-found routes** — missing entities must return HTTP 404, never a soft 404; never put a `loading.tsx` above a `notFound()` route.
- **Infra** — Railway hosts Next.js, Go API, and production Postgres for the ma for now; Cloudflare manages DNS/protection; Resend handles email; Cloudflare R2 and TanStack Start CRM are later/admin-app concerns.
- **Search** — Postgres full-text / trigram first; no Elasticsearch until proven necessary.
- **Soft deletes** — use `deleted_at`; never hard-delete user-facing content without an explicit policy.
- **Audit vs system logs** — audit = entity change history; system = operational/app logs.
- **Testing** — every frontend and backend code change includes or updates regression coverage; run the relevant unit/integration tests plus typecheck and lint before handoff.
