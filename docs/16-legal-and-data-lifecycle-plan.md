# 16 — Legal and data-lifecycle plan

Status captured on 2026-09-04. This is an engineering and product tracker, not
legal advice or a statement that Campus Gaming Network complies with any law.
“Implemented” below means present in the current worktree; it does not mean the
change has been merged, deployed, or legally reviewed.

## Working policy targets

These are the product targets to build against until reviewed copy and operator
decisions replace them:

| Record | Target | Clock |
|---|---|---|
| Support ticket | Purge 12 months after the ticket becomes `resolved` or `closed` | `retention_started_at`; clear it if the ticket is reopened and start a new clock when it next becomes terminal |
| Safety report | Purge 24 months after the report becomes `resolved` or `closed` | `retention_started_at`, with the same reopen/restart behavior |
| Domain audit entry | Purge after 24 months unless it is needed for an active case or hold | Normally `created_at`; define the associated-case rule before automation |
| Database backup | Expire within 90 days | Backup creation date; verify the actual provider schedule and deletion behavior before launch |

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
  updates to the affected records, and removes active school-admin grants.

Known limit: an event soft-cancelled by account deletion does not currently use
the normal cancellation-mail path, so active `yes`/`maybe` attendees are not
notified. That is tracked below as pre-launch work.

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
  Gravatar/Automattic, and any analytics or error-monitoring provider added
  before launch.
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
- [ ] Return the newly cancelled event ids and active `yes`/`maybe` recipients
  from the deletion transaction, then send the existing best-effort
  cancellation email after commit. Email failure must not roll back deletion.
- [x] Add database tests for active successor selection, orphan cancellation,
  child-record archival, past-event archival, and account-related support data.
- [ ] Add handler/service tests for attendee selection and mail failure once
  deletion returns the cancelled-event notification work.

### Gravatar disclosure and opt-out — pre-launch

- [ ] Disclose that the service derives a Gravatar lookup from the normalized
  email and that the browser’s image request contacts Gravatar/Automattic. Do not
  describe an MD5 email hash as anonymous.
- [ ] Add an account-level “use Gravatar” choice with an initials-only option.
  When disabled, neither the API nor the page should emit a Gravatar URL, so the
  browser makes no Gravatar request.
- [ ] Define the default for new and existing users, persist it, include it in
  export/correction behavior, and test both rendering paths.

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

- [ ] Bootstrap and authorize the first `site_admin`; define revocation and
  least-privilege checks before exposing operations data.
- [ ] Add site-admin-only report queue, support queue, and entity audit-history
  endpoints. Test unauthenticated, ordinary-user, revoked-admin, school-admin,
  and site-admin access, plus audit writes for every mutation.
- [ ] Build the CRM report/support queue UI on those endpoints, including
  assignment, status, notes, hold visibility, retention status, and safe
  rendering of user-supplied text.
- [ ] Add authenticated user notification list/unread/mark-read endpoints and an
  in-app notification inbox. Do not expose the repository directly.
- [ ] Adopt audit writes for deletion-triggered queue unassignment and other
  account-lifecycle domain mutations; the current audit guarantee covers queue
  repository patches, not every direct transactional maintenance change.

### Known trust and infrastructure mismatches — pre-launch

- [ ] **`.edu` verification:** product docs and UI define the `verified` level
  as “Verified student,” but email verification currently leaves every `basic`
  account at `basic`. Decide whether verified `.edu` inboxes promote to
  `verified`, implement exact domain parsing and transition rules, and test
  `.edu`, non-`.edu`, mixed-case, subdomain, and lookalike domains. Until then,
  do not imply the badge is automatically awarded.
- [ ] **Forwarded-IP rate limits:** deployment routes traffic through the web
  service/proxies, while the API limiter keys only on `RemoteAddr`. In that
  topology unrelated users may share one limiter bucket. Define the trusted
  proxy chain, forward the original client address, accept a provider header
  only from trusted immediate peers, and test spoofed/multiple forwarded values.
  Replace the process-local limiter before running more than one API instance.

## Completion gate

Before public launch, re-check this tracker against the deployed configuration,
not just source code. At minimum: reviewed Terms/Privacy are published;
versioned signup acceptance is proven end to end; deletion-triggered event email
is complete; `.edu` and client-IP mismatches are resolved; Gravatar behavior is
disclosed and controllable; retention/hold ownership and the backup window are
confirmed; and privacy requests have a usable operating path. These checks are
release criteria, not a claim of compliance.
