# Current State

Quick re-entry point for Campus Gaming Network. Read this first after time away;
the detailed product and engineering context remains in the other documents in
this folder.

**Last updated:** 2026-08-07

## Where we are

The first-release product is implemented locally: authentication, profiles,
schools, launch games, events, teams, dashboard, support, and baseline safety
intake are in place.

Repository deployment configuration is implemented, but deployment and external
environment setup are intentionally deferred while product work continues.

## Current milestone

Make the existing events-and-teams product polished and reliable enough for
real users. Deployment planning and external environment setup will be
revisited later.

## Next three tasks

1. Complete a quality pass on signup, event creation, RSVP, team joining, and
   dashboard flows, including frontend regression coverage, mobile/accessibility
   fixes, and replacement of placeholder legal content.
2. Improve the event lifecycle with recurring events, cancellation notifications,
   and stronger discovery filters.
3. Add trust and identity features: `.edu` verification badges, school
   admin/faculty indicators, organizer badges, and basic content filtering.

## Blockers and decisions

- Deployment work is intentionally deferred and is not currently a blocker.
- Clubs and tournaments remain later expansion work until the current event loop
  is polished and exercised by real users.
- Product and technical questions that are intentionally unresolved are tracked
  in [08 — Open questions](./08-open-questions.md).

## Recently completed

- Changed the school catalog refresh from every 15 minutes to daily.
- Served the school catalog from memory with HTTP caching.
- Removed unused school search indexes.
- Completed several launch-hardening changes, including account deletion,
  password hashing, rate-limit bounds, and HTTP timeouts.
- Established a green verification baseline: API tests, web tests, web lint, and
  web typecheck all pass.
- Regenerated stale Next.js development route metadata that was breaking the
  web typecheck.
- Added regression coverage for event, team, profile, RSVP, private-unlock, and
  team-join form payloads; web tests now cover 20 cases.
- Completed the first mobile/accessibility pass: native labeled checkboxes now
  power age confirmation, paid-event status, and team game selection, and
  custom select controls have explicit accessible names.
- Added an end-to-end event format filter for online, in-person, and hybrid
  events.
- Added readable verification badges to public profiles for community members,
  verified students, and staff/faculty.
- Added event cancellation notifications for active yes/maybe RSVPs, sent as
  best-effort email side effects after the event is cancelled.
- Added weekly, biweekly, and monthly recurring event creation, with independent
  occurrence records, per-occurrence RSVPs, and recurrence details on event
  pages. Recurrence is limited to one year and each occurrence can be cancelled
  separately.

## Resume checklist

1. Read this file.
2. Check the latest commits with `git log -5`.
3. Review [10 — Delivery status](./10-delivery-status.md) for detailed checklists.
4. Start with the first unchecked task under **Next three tasks**.
5. Before stopping, update this file’s milestone, next tasks, blockers, and
   recently completed items.

## Detailed references

- [05 — Roadmap](./05-roadmap.md) — phased product direction
- [10 — Delivery status](./10-delivery-status.md) — detailed Now / Next / Later tracker
- [13 — Deployment plan](./13-deployment-plan.md) — launch setup and smoke test
- [08 — Open questions](./08-open-questions.md) — unresolved decisions
