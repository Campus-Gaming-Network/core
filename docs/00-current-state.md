# Current State

> Open tasks now live in [GitHub Issues](https://github.com/Campus-Gaming-Network/core/issues) and the [CGN core project board](https://github.com/orgs/Campus-Gaming-Network/projects/4). This document remains as reference; its checklists are no longer updated.

Quick re-entry point for Campus Gaming Network. Read this first after time away;
the detailed product and engineering context remains in the other documents in
this folder.

**Last updated:** 2026-10-19

## Where we are

The first-release product is implemented: authentication with email and
password changes, profiles with game lists, schools, an IGDB-imported game
catalog with popular games, events with co-organizers and keyword search,
teams, the dashboard, a notification inbox, data export, support, and
baseline safety intake. Clubs are in place: club records and pages, claims, owners and editors,
joining, a `/clubs` directory, last-confirmed dates, club-hosted events, and
Admin Console club management.

The web app and the Admin Console are TanStack Start apps in `apps/web` and
`apps/admin`. The JavaScript toolchain is Vite+ (`vp`), which runs builds,
Vitest unit tests, Oxlint, and Oxfmt; see
[11 — Implementation decisions](./11-implementation-decisions.md).

A Railway staging environment is running, with the Admin Console as a separate
service ([13 — Deployment plan](./13-deployment-plan.md)). Production is not
deployed and has no real accounts. Cloudflare-path validation and production
deployment are intentionally deferred while product work continues.

## Current milestone

Make the events-and-teams product polished and reliable enough for real users,
and build out clubs ([05 — Roadmap, Phase 6a](./05-roadmap.md#phase-6a--clubs)).
Production deployment will be revisited later.

Every item in [17 — Codebase review action plan](./17-codebase-review-action-plan.md)
is done. Engineering work comes from the open
[GitHub Issues](https://github.com/Campus-Gaming-Network/core/issues).

## Next tasks

1. Finish what `AC-014` still owes, none of which needs code: the independent
   security review, then the staging penetration pass, drills, and deployment
   smoke checks on staging
   ([24](./24-admin-console-security-review.md#still-owed-before-production-is-enabled)).
2. Clear the P1 launch gates that need outside input: legal copy and the
   external launch rehearsal.
3. Bring back the paused Playwright suites before launch (#244).

Admin Console work continues under
[20 — Admin Console v1 engineering plan](./20-admin-console-v1-engineering-plan.md).

## Blockers and decisions

- Production deployment is intentionally deferred and is not currently a blocker.
- Production legal copy is waiting on operator identity/address, governing law,
  launch geography, provider, and sale/share decisions. Engineering retention
  targets are recorded in [16 — Legal and data-lifecycle plan](./16-legal-and-data-lifecycle-plan.md)
  pending legal review.
- Tournaments are being built: an organizer sets up a tournament-type event's
  tournament (with an optional link to a bracket on another site) and moves
  its status at `/events/:slug/tournament`, and
  players and teams register and withdraw on the event page; brackets and
  results are not built yet. The spec is in [01 — Product](./01-product.md#tournaments).
- Product and technical questions that are intentionally unresolved are tracked
  in [08 — Open questions](./08-open-questions.md).

## Recently completed

Completed work is recorded where it is tracked instead of being repeated here:
review items in [17 — Codebase review action plan](./17-codebase-review-action-plan.md),
Admin Console tickets in [20 — Admin Console v1 engineering plan](./20-admin-console-v1-engineering-plan.md),
and features and launch gates in [10 — Delivery status](./10-delivery-status.md).
`git log` has the full change history.

## Resume checklist

1. Read this file.
2. Check the latest commits with `git log -5`.
3. Review the open issues on the
   [CGN core project board](https://github.com/orgs/Campus-Gaming-Network/projects/4).
4. Before stopping, update the issues you worked on, and this file's milestone
   and blockers if they changed.

## Detailed references

- [05 — Roadmap](./05-roadmap.md) — phased product direction
- [10 — Delivery status](./10-delivery-status.md) — detailed Now / Next / Later tracker
- [13 — Deployment plan](./13-deployment-plan.md) — launch setup and smoke test
- [08 — Open questions](./08-open-questions.md) — unresolved decisions
- [16 — Legal and data-lifecycle plan](./16-legal-and-data-lifecycle-plan.md) — legal blockers, retention targets, and pre-launch lifecycle checklist
- [17 — Codebase review action plan](./17-codebase-review-action-plan.md) — prioritized review findings, acceptance criteria, and work order
