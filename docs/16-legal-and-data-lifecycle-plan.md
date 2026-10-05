# 16 — Legal and data-lifecycle plan

> Open tasks now live in [GitHub Issues](https://github.com/Campus-Gaming-Network/core/issues) and the [CGN core project board](https://github.com/orgs/Campus-Gaming-Network/projects/4). This document remains as reference; its checklists are no longer updated.

Status captured on 2026-09-04. This is an engineering and product tracker, not
legal advice or a statement that Campus Gaming Network complies with any law.
“Implemented” below means present in the current worktree; it does not mean the
change has been merged, deployed, or legally reviewed.

## Working policy targets

These are the product targets to build against until reviewed copy and operator
decisions replace them:

| Record             | Target                                                               | Clock                                                                                                          |
| ------------------ | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Support ticket     | Purge 12 months after the ticket becomes `resolved` or `closed`      | `retention_started_at`; clear it if the ticket is reopened and start a new clock when it next becomes terminal |
| Safety report      | Purge 24 months after the report becomes `resolved` or `closed`      | `retention_started_at`, with the same reopen/restart behavior                                                  |
| Domain audit entry | Purge after 24 months unless it is needed for an active case or hold | Normally `created_at`; define the associated-case rule before automation                                       |
| Database backup    | Expire within 90 days                                                | Backup creation date; verify the actual provider schedule and deletion behavior before launch                  |

No eligible record should be purged until a legal-hold check has run. An active
investigation, appeal, dispute, preservation request, or applicable legal duty
may suspend the ordinary clock for the minimum necessary records. Access and use
remain limited to the reason for retention. The California Attorney General’s
[consumer deletion guidance](https://oag.ca.gov/privacy/ccpa) describes deletion
rights and exceptions that should be considered when the launch scope is known.

## Now — implemented foundation and current behavior

### Operations foundation

- [x] Migration `000010_operations_foundation.up.sql` adds report/support
      assignment, resolution notes, retention-clock timestamps and cleanup indexes;
      append-oriented `audit_logs`; and user-scoped `notifications`.
- [x] Report and support queue repository updates write their before/after audit
      record in the same transaction as the queue change.
- [x] A report or ticket first entering `resolved` or `closed` starts its
      retention clock. A terminal-to-terminal change preserves it; reopening clears
      it; and a later terminal transition starts a fresh clock. Existing terminal
      records are conservatively backfilled from `updated_at`.
- [x] Notification repository reads and mark-read operations are scoped to the
      owning user, and creation locks and verifies an active recipient so deletion
      cannot race with a new notification. Notifications are deleted during
      account deletion.
- [x] CI now provisions PostgreSQL, applies migrations, and supplies
      `API_DATABASE_URL` before `go test ./...`, so database-backed operations and
      account-deletion tests no longer silently skip in CI.

The foundation deliberately has no public or admin HTTP routes yet. Repository
methods alone do not provide site-admin authorization.

### Account deletion

The current deletion transaction:

- [x] Replaces the user’s email and name, removes the bio, resets account trust
      fields, marks the account deleted, revokes live sessions, and removes pending
      verification/reset tokens.
- [x] Deletes personally scoped social links, school follows, team memberships,
      event RSVPs/interests, event-organizer membership, and notifications.
- [x] Transfers an owned team to the longest-tenured captain, then member, or
      soft-deletes a team with no successor.
- [x] Transfers a future created event to the longest-tenured other active
      organizer. It archives future events with no active successor and archives
      past events rather than rewriting their historical creator.
- [x] Detaches support tickets from the deleted account. Terminal tickets also
      have their direct contact email/name scrubbed; open or in-review tickets keep
      contact fields so the support conversation can finish and carry a deletion
      marker so the queue transition scrubs them when they become terminal.
- [x] Unassigns report/support work assigned to the deleted user and retains
      domain audit history. Reports can remain linked to the now-anonymized user row.
- [x] Ignores suspended/deleted team and event successor candidates, scopes role
      updates to the affected records, and revokes active school-admin and
      site-admin grants while keeping their history. Deleting the last active
      site admin is refused with `409 last_site_admin`.
- [x] Queues a cancellation email to active `yes`/`maybe` attendees of each
      archived event that has not ended (see the event lifecycle section below).

Retained records may still contain incidental personal information in support
messages, report reasons, resolution notes, notification payloads, or audit JSON.
Removing the direct user foreign key or contact columns is not sufficient to
anonymize those free-text and JSON fields.

## Blocked — operator facts and reviewed legal copy

Production Terms and Privacy copy should remain blocked until the operator
supplies and confirms:

- [ ] Legal operator name, any public business name, physical/mailing address,
      and support/privacy contact details.
- [ ] State/country of formation, intended governing law and venue, and whether
      the Terms will include arbitration or a class-action waiver.
- [ ] Initial launch geography and whether access will be limited to the United
      States and adults age 18 or older.
- [ ] Final provider list and purposes, including Railway, Cloudflare, Resend,
      and any analytics or error-monitoring provider added before launch.
- [ ] Whether personal information is sold or shared for cross-context
      behavioral advertising, and whether targeted advertising is planned.
- [ ] Confirmation of the retention targets in this document, the provider’s
      real backup retention/deletion behavior, and who may authorize a legal hold.
- [ ] A contact and operating process for access, correction, deletion, and
      appeal requests.

Only after those facts and the exact document text are settled should the team
assign production policy versions and make acceptance mandatory. The Ninth
Circuit’s [Berman v. Freedom Financial Network opinion](https://cdn.ca9.uscourts.gov/datastore/opinions/2022/04/05/20-16900.pdf)
is the already-reviewed primary source for making terms conspicuous and tying
affirmative action to assent; final signup copy and presentation still need
legal review for the actual launch.

## Later — tracked implementation

Items marked **pre-launch** should not wait until after a public release.

### Versioned Terms agreement and Privacy acknowledgement — pre-launch

- [ ] Add immutable policy-document records with document type, public version,
      effective time, content hash, and the exact rendered artifact or durable
      source reference. Publishing a new version must not mutate the old one.
- [ ] Add append-only user acceptance records with user, policy-document id,
      accepted time, and source (`signup` or `policy_update`). Do not collect an IP
      address or user agent solely for this record without a documented need and
      retention rule.
- [ ] Keep the semantics separate: the user **agrees** to the Terms and
      **acknowledges** the Privacy Policy. Use a required, initially unchecked
      signup control with direct links to both exact versions.
- [ ] Extend signup API input and validation so the server records the currently
      published versions in the same transaction as account creation and rejects
      missing, false, stale, or unknown document/version claims. Do not trust a
      client-supplied version without resolving it to a published server record.
- [ ] Extend the signup UI/action payload and accessible validation/error copy.
- [ ] Add migration tests; repository/service/handler tests; web payload and
      component tests; and an end-to-end signup test that proves the two accepted
      versions were stored.
- [ ] Migration rule: do not fabricate historical acceptance for existing
      users. Leave them without an acceptance record and route them through the
      existing-user flow below.
- [ ] Define “material change,” notice timing, grace period, and which changes
      require renewed Terms agreement versus notice or a legally required privacy
      consent.

### Existing-user reacceptance — pre-launch if accounts already exist

- [ ] Present the current required Terms version after login when no matching
      acceptance exists; preserve access to account deletion, privacy requests, and
      logout even when the user declines.
- [ ] Record each new affirmative acceptance rather than overwriting history.
- [ ] Send or display the required change notice and test the accepted,
      declined, stale-version, and interrupted-session paths.

### Retention, holds, and purge jobs — pre-launch policy; automation may follow

- [ ] Model legal holds with scope, reason, creator, start/end timestamps and an
      auditable release action. The purge query must exclude held records before any
      delete or redaction occurs.
- [ ] Implement idempotent, bounded cleanup jobs for the 12-month support and
      24-month report/audit targets, with dry-run counts, metrics, failure alerts,
      and tests around terminal transitions and exact cutoff boundaries.
- [ ] Decide whether each expiry action hard-deletes the row or preserves a
      minimal non-personal aggregate. Never keep the original free text under the
      label “anonymous” without proving it has been de-identified.
- [ ] Inventory and minimize incidental personal information in support
      messages, report reasons, resolution notes, and audit before/after/metadata
      JSON. Avoid copying full record bodies into audit entries when a narrower
      change record is sufficient.
- [ ] Document a manual runbook until cleanup is automated: owner, cadence,
      query/review steps, hold check, evidence recorded, and recovery procedure.
- [ ] Configure backups to expire within 90 days, document that deleted data may
      persist in isolated backups until expiry, restrict restoration access, and
      ensure restored data is re-subjected to completed deletion/purge requests.

### Event lifecycle on account deletion — pre-launch

- [x] Transfer future events with another active organizer; archive future
      events without one and archive past events without rewriting ownership.
- [x] Queue one cancellation email per active `yes`/`maybe` recipient of each
      cancelled event that has not ended, in the deletion transaction's email
      outbox. The outbox worker delivers and retries after commit, so email
      failure cannot roll back deletion.
- [x] Add database tests for active successor selection, orphan cancellation,
      child-record archival, past-event archival, and account-related support data.
- [x] Test attendee selection (active `yes`/`maybe` recipients, no email for
      ended events) against PostgreSQL; outbox tests cover retry, poison
      messages, and delivery after commit.

### Avatars — resolved

The web app draws each avatar itself from the public user id, using the
Boring Avatars library (MIT) and its Beam style. No browser contacts an
avatar service, so Boring Avatars is not a provider, and no opt-out or separate
disclosure is needed. The avatar is a pure function of the id and stores
nothing new.

- [ ] Privacy copy may say, in one sentence, that avatars are generated by this
      site from the public user id.

### People lists

Signed-in people can list who is going to an event, who has a school as their
home school, and who is on a team (`GET /events/:slug/attendees`,
`GET /schools/:slug/members`, `GET /teams/:slug/members`). The lists make each
listed person’s name, avatar id, verification level, and trust indicators visible
to every signed-in account, so they are part of the privacy inventory.

- [x] Only signed-in viewers can read a list. Anonymous requests get `401`, and
      list responses are marked `private, no-store`.
- [x] A row carries the person’s id (the input to the avatar), name,
      verification level, role indicators, and team role. It carries no email
      address, bio, school, or RSVP answer.
- [x] A user can opt out with the `show_in_lists` account setting, on by default.
      Opting out removes them from every list immediately and leaves their RSVPs,
      memberships, and counts unchanged.
- [x] Deleted, suspended, and email-unverified accounts are never listed. Account
      deletion also removes the person’s memberships and RSVPs outright.
- [x] A private event’s list is gated like the event page, so its attendees are
      not disclosed to a viewer who has not unlocked it.
- [ ] Privacy copy should say that signed-in members can see the name and avatar
      of people who RSVP to an event, belong to a school, or join a team, and
      that the account setting turns this off. Decide with counsel whether the
      default should be opt-out (current) or opt-in before launch.

### Privacy request operations

- [ ] Add authenticated data export covering profile, school relationships,
      teams, events, RSVPs/interests, support/report submissions, notifications,
      and policy-acceptance history, with secure generation, expiry, and audit.
- [ ] Add correction paths for editable profile data and a support workflow for
      records that cannot safely be self-edited. Document identity verification,
      request status, response deadlines, denial/appeal handling, and authorized
      agents after launch geography is known.
- [ ] Keep deletion and privacy-request access available to users who decline a
      new Terms version.

### Operations surfaces

Site-admin bootstrap, the report/support queue and audit endpoints, and the
queue UI are tracked as `AC-003`, `AC-008`, and `AC-012` in
[20 — Admin Console v1 engineering plan](./20-admin-console-v1-engineering-plan.md).

- [ ] Add authenticated user notification list/unread/mark-read endpoints and an
      in-app notification inbox. Do not expose the repository directly.
- [ ] Adopt audit writes for deletion-triggered queue unassignment and other
      account-lifecycle domain mutations; the current audit guarantee covers queue
      repository patches, not every direct transactional maintenance change.

### Known trust and infrastructure mismatches — pre-launch

- [x] **`.edu` verification:** verified inboxes whose normalized domain ends
      exactly in `.edu` promote `basic` accounts to `verified`; valid subdomains
      and mixed case qualify, lookalike suffixes do not, and staff/faculty grants
      are preserved. The product copy treats this as a limited domain trust signal,
      not proof of enrollment, current affiliation, or identity.
- [x] **Forwarded-IP rate limits:** the BFF forwards an authenticated,
      normalized visitor address from Railway or Cloudflare, and the API keys
      limits by visitor, target, and account (`CGN-001` in
      [17](./17-codebase-review-action-plan.md)). The limiter is still
      process-local, so run one API instance until it is replaced.

## Completion gate

Before public launch, re-check this tracker against the deployed configuration,
not just source code. At minimum: reviewed Terms/Privacy are published;
versioned signup acceptance is proven end to end; deletion-triggered event email
is complete; `.edu` and client-IP mismatches are resolved; retention/hold ownership and the backup window are
confirmed; and privacy requests have a usable operating path. These checks are
release criteria, not a claim of compliance.
