# Current State

Quick re-entry point for Campus Gaming Network. Read this first after time away;
the detailed product and engineering context remains in the other documents in
this folder.

**Last updated:** 2026-09-28

## Where we are

The first-release product is implemented locally: authentication, profiles,
schools, launch games, events, teams, dashboard, support, and baseline safety
intake are in place. TanStack Start is now the canonical main frontend in
`apps/web`; the temporary parity application has been folded into that path and
the Next.js source has been removed.

Repository deployment configuration is implemented, but Railway has not been
provisioned. Staging, Cloudflare-path validation, and production deployment are
therefore intentionally deferred while product work continues.

## Current milestone

Make the existing events-and-teams product polished and reliable enough for
real users. Deployment planning and external environment setup will be
revisited later.

The active engineering execution queue is now
[17 — Codebase review action plan](./17-codebase-review-action-plan.md). It turns
the latest repository review into prioritized work with acceptance criteria and
verification steps.

## Next three tasks

1. Complete `AC-010`: the 5 MB school-logo upload pipeline, which unblocks the
   Admin Console catalog UI.
2. Complete `AC-013`: the Admin Console catalog, user, and access UI.
3. Decide whether multi-organizer management belongs in the first release, which
   unblocks `CGN-016`, the last open review item.

Legal, DiceBear, and external launch rehearsal remain P1 launch gates. Admin
Console work continues under
[20 — Admin Console v1 engineering plan](./20-admin-console-v1-engineering-plan.md).

## Blockers and decisions

- Deployment work is intentionally deferred and is not currently a blocker.
- Production legal copy is waiting on operator identity/address, governing law,
  launch geography, provider, and sale/share decisions. Engineering retention
  targets are recorded in [16 — Legal and data-lifecycle plan](./16-legal-and-data-lifecycle-plan.md)
  pending legal review.
- Clubs and tournaments remain later expansion work until the current event loop
  is polished and exercised by real users.
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
3. Review [10 — Delivery status](./10-delivery-status.md) for detailed checklists.
4. Review [17 — Codebase review action plan](./17-codebase-review-action-plan.md)
   and start with the first ready item in execution order.
5. Before stopping, update this file’s milestone, next tasks, and blockers, and
   record completed work in the doc that tracks it.

## Detailed references

- [05 — Roadmap](./05-roadmap.md) — phased product direction
- [10 — Delivery status](./10-delivery-status.md) — detailed Now / Next / Later tracker
- [13 — Deployment plan](./13-deployment-plan.md) — launch setup and smoke test
- [08 — Open questions](./08-open-questions.md) — unresolved decisions
- [16 — Legal and data-lifecycle plan](./16-legal-and-data-lifecycle-plan.md) — legal blockers, retention targets, and pre-launch lifecycle checklist
- [17 — Codebase review action plan](./17-codebase-review-action-plan.md) — prioritized review findings, acceptance criteria, and work order
