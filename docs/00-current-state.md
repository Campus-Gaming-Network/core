# Current State

Quick re-entry point for Campus Gaming Network. Read this first after time away;
the detailed product and engineering context remains in the other documents in
this folder.

**Last updated:** 2026-09-12

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

1. Decide the DST rules needed for `CGN-008`, then generate recurrences in the
   event's IANA timezone.
2. Complete `CGN-015`: exercise the deployed BFF/API/database boundary in CI.
3. Complete `CGN-012`: stop writing `last_seen_at` on every authenticated read.

After those, follow the ordered queue in doc 17. Legal, DiceBear,
account-deletion notifications, and external launch rehearsal remain P1 launch
gates. CRM/admin UI work moves behind the review's P1 queue.

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

- Completed the local main-frontend cutover from Next.js to TanStack Start.
  `apps/web` now owns the TanStack Router route tree, server functions, Vite
  build, Nitro production process, Docker image, and browser tests. The
  temporary `apps/web-start` application was removed after full local parity,
  privacy, accessibility, HTTP, and container gates passed.
- Added explicit `local`, `staging`, and `production` deployment modes. Web and
  API startup now reject unsafe strict-mode URLs, cookies, credentials,
  senders, secrets, and runtime values before accepting traffic while local
  Docker Compose retains its provider-free defaults (`CGN-013`).
- Replaced email-derived avatar URLs with DiceBear Critters avatars using the
  public user id as the stable seed and the style's default preset.
- Replaced raw ISO/IANA event entry with native local date/time controls and a
  profile-defaulted curated timezone selector. Server-side operations convert to
  instants and reject nonexistent or ambiguous DST wall times with accessible
  field errors (`CGN-009`).
- Removed recurrence controls from event edits, explained independent
  occurrence editing, and made both the web operation and API reject recurrence
  mutations instead of silently discarding them (`CGN-007`).
- Added filter-preserving previous/next navigation to school, event, and team
  browse pages. Event and team lists use opaque bidirectional keyset cursors;
  schools use offset pages plus explicit `has_more` metadata without a total
  count query (`CGN-006`).
- Promoted verified `.edu` inboxes to the verified-student trust tier using an
  exact normalized-domain rule, while preserving staff/faculty grants and
  exposing the resulting level consistently on profiles and organizer summaries
  (`CGN-003`).
- Made signup plus token creation, token consumption plus account verification,
  and profile fields plus social-link replacement transactional (`CGN-004`).
- Replaced fixed first-page school selects with one accessible, searchable
  picker across signup, event creation/editing, and team creation (`CGN-005`).
- Changed email verification so opening an emailed link only shows a
  confirmation page. The API now accepts the token through POST only, consumes
  it exactly once after explicit confirmation, and preserves resend recovery
  for expired or already-used links (`CGN-002`).
- Preserved trusted visitor identity through Cloudflare, the Railway web BFF,
  and the private Go API using authenticated, normalized forwarding headers;
  corrected anonymous, target, and account rate-limit keys and documented the
  single-API-instance scaling boundary (`CGN-001`).
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
- Before the frontend migration, regenerated stale Next.js development route
  metadata that was breaking the web typecheck.
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
4. Review [17 — Codebase review action plan](./17-codebase-review-action-plan.md)
   and start with the first ready item in execution order.
5. Before stopping, update this file’s milestone, next tasks, blockers, and
   recently completed items.

## Detailed references

- [05 — Roadmap](./05-roadmap.md) — phased product direction
- [10 — Delivery status](./10-delivery-status.md) — detailed Now / Next / Later tracker
- [13 — Deployment plan](./13-deployment-plan.md) — launch setup and smoke test
- [08 — Open questions](./08-open-questions.md) — unresolved decisions
- [16 — Legal and data-lifecycle plan](./16-legal-and-data-lifecycle-plan.md) — legal blockers, retention targets, and pre-launch lifecycle checklist
- [17 — Codebase review action plan](./17-codebase-review-action-plan.md) — prioritized review findings, acceptance criteria, and work order
