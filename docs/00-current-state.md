# Current State

Quick re-entry point for Campus Gaming Network. Read this first after time away;
the detailed product and engineering context remains in the other documents in
this folder.

**Last updated:** 2026-09-04

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

1. Replace the placeholder Terms and Privacy pages after operator identity,
   jurisdiction, and provider decisions are confirmed; then add versioned
   signup acceptance.
2. Close the remaining pre-launch lifecycle gaps: notify attendees when account
   deletion cancels an event, decide Gravatar defaults/opt-out, and fix the
   `.edu` verification and forwarded-IP rate-limit mismatches.
3. Build the authenticated surfaces on the new operations foundation: bootstrap
   a site-admin role, expose guarded reports/support/audit endpoints, and add the
   CRM queue and user-notification UIs.

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

- Added Zod-backed runtime contracts for every web-to-Go success response and
  server-side form validation with accessible field errors. Contract types are
  inferred from schemas, while Go remains authoritative for domain and security
  rules.
- Changed the school catalog refresh from every 15 minutes to daily.
- Served the school catalog from memory with HTTP caching.
- Removed unused school search indexes.
- Completed several launch-hardening changes, including account deletion,
  password hashing, rate-limit bounds, and HTTP timeouts.
- Established a green verification baseline: API tests, web tests, web lint, and
  web typecheck all pass.
- Regenerated stale Next.js development route metadata that was breaking the
  web typecheck.
- Added regression coverage for event, team, profile, RSVP, private-unlock,
  team-join, API response contracts, and cross-field form validation.
- Completed the first mobile/accessibility pass: native labeled checkboxes now
  power age confirmation, paid-event status, and team game selection, and
  custom select controls have explicit accessible names.
- Added an end-to-end event format filter for online, in-person, and hybrid
  events.
- Added readable verification badges to public profiles for community members,
  verified students, and staff/faculty.
- Added school-admin grants and visible school-admin/staff-faculty role
  indicators on profiles and event organizer summaries.
- Added event organizer role badges for organizers connected to the host school
  or verified as staff/faculty.
- Added a server-side blocked-term filter for user-authored names, bios, event
  and team text, reports, and support messages.
- Added event cancellation notifications for active yes/maybe RSVPs, sent as
  best-effort email side effects after the event is cancelled.
- Added weekly, biweekly, and monthly recurring event creation, with independent
  occurrence records, per-occurrence RSVPs, and recurrence details on event
  pages. Recurrence is limited to one year and each occurrence can be cancelled
  separately.
- Added desktop/mobile Playwright coverage for signup/resend, event
  create/interest/cancel, private unlock through RSVP, team
  join/captain/ownership transfer, and dashboard composition, including
  automated WCAG A/AA checks.
- Locked signup acceptance for required home-school selection and persisted 18+
  confirmation with HTTP, service, and repository regression coverage.
- Locked verification-email delivery and per-address/IP resend throttling with
  service, Resend transport, and HTTP contract coverage.
- Verified that blocked-language signup names return `invalid_request` before
  the user repository is called.
- Completed event-create acceptance for public events, private unlock gating,
  capacity, and paid off-site registration details across API and browser tests.
- Added handler-level recurrence acceptance for weekly, biweekly, and monthly
  events and fixed the inclusive one-year calendar-date boundary.
- Verified soft cancellation still succeeds when email delivery fails while
  attempting notifications for every active yes/maybe RSVP recipient.
- Expanded RSVP acceptance across yes/maybe/no, independent interest state,
  yes-only capacity counting, and the exact Resend ICS attachment; also fixed
  selected-button contrast to meet WCAG AA.
- Added coverage for host-scoped organizer/profile role indicators and blocked
  terms across the remaining event, team, profile, support, and report fields.
- Added the moderation/operations data foundation: assignable report and support
  queues with terminal retention clocks, transactional before/after audit
  history, and user-scoped in-app notification storage and repository
  primitives. PostgreSQL-backed tests now run in CI. These remain internal
  until site-admin authorization and user-facing endpoints are implemented.
- Strengthened account deletion: event ownership transfers to the longest-tenured
  active co-organizer or the event is soft-cancelled; support tickets are
  detached and terminal-ticket contact fields are scrubbed; personal
  notifications are removed; and operations queues are unassigned.

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
- [16 — Legal and data-lifecycle plan](./16-legal-and-data-lifecycle-plan.md) — legal blockers, retention targets, and pre-launch lifecycle checklist
