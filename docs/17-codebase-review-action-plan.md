# 17 — Codebase review action plan

Actionable backlog from the 2026-09-05 codebase review of `next` at `5da5f14`.
This document turns the review findings into an ordered execution plan. Product
scope still comes from [01 — Product](./01-product.md), and delivery status still
lives in [10 — Delivery status](./10-delivery-status.md). When they disagree on
which engineering work to do next, use the priority order here until this review
backlog is closed or deliberately reprioritized.

## Verdict

The architecture is on the right track, and the implementation has a stronger
security, testing, migration, and operations foundation than most projects at
this stage. It is not ready for a broad public launch. The largest risks are at
the boundaries between the browser, BFF, API, database, and email provider, and
in user journeys that cannot yet reach all of the data the backend supports.

Do not begin clubs, tournaments, the CRM UI, uploads, payments, or another large
foundation slice until the P1 queue below is complete and a real-stack staging
rehearsal has passed.

## How to work this backlog

- Work in the recommended queue order below. IDs are stable references, not a
  second statement of priority.
- Give each item its own focused change or tightly related change set.
- Add or update regression coverage with every behavior change.
- Do not mark an item complete until all acceptance criteria and verification
  steps pass.
- Update this document, [00 — Current state](./00-current-state.md), and the
  corresponding entry in [10 — Delivery status](./10-delivery-status.md), if
  one exists, when an item changes status.
- Record a short decision in [11 — Implementation decisions](./11-implementation-decisions.md)
  when a fix establishes a new cross-cutting rule.

Use `Ready`, `Needs product rule confirmation`, `In progress`, `Blocked`, and
`Done` as the status vocabulary. Put the owner and change/PR link beside the
status when work begins.

### Priority definitions

| Priority | Meaning |
|----------|---------|
| P0 | Active data-loss or security emergency. None found in this review. |
| P1 | Must complete before inviting public users. |
| P2 | Complete during private beta or before traffic grows. |
| P3 | Maintainability work that should precede the next major product area. |

### Size guide

| Size | Expected scope |
|------|----------------|
| S | A focused change, usually one layer and a small test update. |
| M | A vertical slice across two layers or a non-trivial data change. |
| L | A multi-layer change requiring design, migration, or broad regression coverage. |
| XL | Split into a design task and multiple implementation tasks before starting. |

## Recommended execution order

Product/legal owners can advance the external launch gates in parallel with
the engineering queue, but all P1 work must be complete before public access.

| Queue | Item | Priority | Outcome unlocked |
|------:|------|----------|------------------|
| 1 | `CGN-001` | P1 | Per-visitor abuse controls work behind the BFF. |
| 2 | `CGN-002` | P1 | Email scanners cannot mutate account state. |
| 3 | `CGN-003` | P1 | The advertised student-verification badge is real. |
| 4 | `CGN-004` | P1 | Account writes no longer partially commit. |
| 5 | `CGN-013` | P1 | Unsafe production deployments fail at startup. |
| 6 | `CGN-005` | P1 | All schools are selectable in core forms. |
| 7 | `CGN-006` | P1 | All browse results are reachable. |
| 8 | `CGN-007` | P1 | Event edits stop claiming unsupported recurrence changes. |
| 9 | `CGN-008` | P1 | Recurrences remain correct through DST and short months. |
| 10 | `CGN-009` | P1 | Event time entry is usable without ISO/IANA expertise. |
| 11 | `CGN-010` | P1 | Email side effects are bounded, durable, and idempotent. |
| 12 | `CGN-015` | P1 | CI proves the BFF/API/database system as deployed. |
| 13 | `CGN-011` | P2 | Static/public routes survive API failure and avoid needless session work. |
| 14 | `CGN-012` | P2 | Read traffic stops creating a session write for every API request. |
| 15 | `CGN-014` | P2 | Users can distinguish no data from service failure. |
| 16 | `CGN-020` | P2 | Redirect notices have truthful, typed severity. |
| 17 | `CGN-017` | P2 | HTTP status no longer depends on error wording. |
| 18 | `CGN-019` | P2 | Documentation has one maintained source per fact. |
| 19 | `CGN-016` | P2 | Multi-organizer scope matches the product promise. |
| 20 | `CGN-018` | P3 | Large modules are split before product expansion. |

`CGN-003` is next and requires confirmation of the `.edu` product rule before
implementation. `CGN-004` follows it. If that decision is not ready, `CGN-013`
is the first independent implementation item that can advance safely. Before
`CGN-008`, decide how nonexistent/repeated DST times and event duration behave.
Before `CGN-016`, decide whether multi-organizer management belongs in the
first release.

### Implementation map

| Items | Primary starting points |
|-------|-------------------------|
| `CGN-001` | [`apps/web/lib/bff-api.ts`](../apps/web/lib/bff-api.ts), [`auth_handlers.go`](../apps/api/internal/httpapi/auth_handlers.go), [`visitor_identity.go`](../apps/api/internal/httpapi/visitor_identity.go), and [`limiter.go`](../apps/api/internal/ratelimit/limiter.go) |
| `CGN-002`–`CGN-004` | [`verify-email/page.tsx`](../apps/web/app/auth/verify-email/page.tsx), [`actions.ts`](../apps/web/app/actions.ts), [`auth/service.go`](../apps/api/internal/auth/service.go), [`auth/tokens.go`](../apps/api/internal/auth/tokens.go), and [`users.go`](../apps/api/internal/users/users.go) |
| `CGN-005`–`CGN-006` | [`server-api.ts`](../apps/web/lib/server-api.ts), [`event-form.tsx`](../apps/web/components/event-form.tsx), [`team-form.tsx`](../apps/web/components/team-form.tsx), and the school/event/team browse pages and Go repositories |
| `CGN-007`–`CGN-009` | [`action-payloads.ts`](../apps/web/lib/action-payloads.ts), [`form-validation.ts`](../apps/web/lib/form-validation.ts), [`event-form.tsx`](../apps/web/components/event-form.tsx), [`event_handlers.go`](../apps/api/internal/httpapi/event_handlers.go), and [`events.go`](../apps/api/internal/events/events.go) |
| `CGN-010` | [`auth/mailer.go`](../apps/api/internal/auth/mailer.go), [`events/mailer.go`](../apps/api/internal/events/mailer.go), account/event services, and [`db/migrations`](../db/migrations/) |
| `CGN-011`–`CGN-012` | [`app/layout.tsx`](../apps/web/app/layout.tsx), [`server-api.ts`](../apps/web/lib/server-api.ts), and [`auth/postgres.go`](../apps/api/internal/auth/postgres.go) |
| `CGN-013` | [`config.go`](../apps/api/internal/config/config.go), [`main.go`](../apps/api/cmd/api/main.go), and deployment configuration under [`railway`](../railway/) |
| `CGN-014`, `CGN-020` | Public route pages, [`cgn-api.ts`](../apps/web/lib/cgn-api.ts), and shared notice/error components |
| `CGN-015` | [`playwright.config.ts`](../apps/web/playwright.config.ts), [`pass-v0.spec.ts`](../apps/web/tests/e2e/pass-v0.spec.ts), [`docker-compose.yml`](../docker-compose.yml), and [`ci.yml`](../.github/workflows/ci.yml) |
| `CGN-016`–`CGN-018` | [`events.go`](../apps/api/internal/events/events.go), [`users/deletion.go`](../apps/api/internal/users/deletion.go), HTTP handlers, [`actions.ts`](../apps/web/app/actions.ts), and [`router_test.go`](../apps/api/internal/httpapi/router_test.go) |
| `CGN-019` | [`docs`](./), starting with [`04 — API`](./04-api.md) and [`10 — Delivery status`](./10-delivery-status.md) |

---

## P1 — Request identity and account trust

### CGN-001 — Preserve trusted visitor identity for rate limits

**Priority:** P1  
**Size:** M  
**Status:** Complete (2026-09-05)

**Depends on:** Deployment trust boundary in [13 — Deployment plan](./13-deployment-plan.md)

**Completed:** The BFF now selects a normalized visitor address from Railway's
trusted `X-Real-IP`, or from Cloudflare's `CF-Connecting-IP` when an
edge-overwritten origin secret authenticates it. A second shared secret
authenticates the BFF assertion to the private API. Missing, malformed, and
spoofed assertions fall back to the direct peer. Limiter keys now distinguish
visitor, normalized email, opaque token, event, and authenticated account
dimensions, and the one-replica constraint is documented.

**Problem**

The Go API keys rate limits from `req.RemoteAddr`, but production requests reach
it from the Next.js BFF over Railway private networking. The BFF does not forward
a trusted visitor identifier. Unauthenticated signup, login, password-reset,
support, and private-event-unlock traffic can therefore share the web service's
private address. One user may consume another user's quota, and an attacker may
deny access to a flow for everyone behind that BFF instance.

**Action**

1. Define the trusted proxy boundary: only the private BFF may supply the API's
   visitor-IP header.
2. At the BFF, derive the visitor address from the hosting platform's documented
   forwarding headers; normalize IPv4/IPv6 and reject malformed values.
3. Forward it in a dedicated internal header. Do not blindly relay a browser-
   supplied header.
4. At the API, trust the header only when the request came through the expected
   private proxy boundary; otherwise fall back to `RemoteAddr`.
5. Review every limiter key. Use the appropriate combination of visitor,
   account, target, and normalized email rather than a single global bucket.
6. Make the policy compatible with more than one API instance, or explicitly
   keep one instance until the process-local limiter is replaced.

**Acceptance criteria**

- Two visitors through the same BFF receive independent unauthenticated quotas.
- A caller cannot spoof another visitor by sending the internal header directly.
- Private-event attempts are isolated by event and visitor.
- Login/signup retain an abuse-control bucket that cannot globally lock out the
  application.
- Trusted-proxy assumptions and scaling limits are documented.

**Verification**

- Go tests for trusted, missing, malformed, IPv4, IPv6, and spoofed headers.
- BFF request tests proving visitor identity is forwarded on every limited flow.
- A real-stack test with two simulated visitors behind one BFF.

### CGN-002 — Make email verification an explicit POST action

**Priority:** P1  
**Size:** M  
**Status:** Complete (2026-09-05)
**Depends on:** None

**Completion note:** The emailed GET now renders a confirmation screen without
calling the API. A validated Server Action sends the token in a POST body; the
Go handler rejects GET with 405 and consumes valid tokens only once. Missing,
altered, expired, and replayed tokens return the existing safe error and reveal
the resend flow. Handler, validation, and desktop/mobile browser coverage lock
the behavior.

**Problem**

Rendering `/auth/verify-email?token=...` currently consumes the token and changes
account state. Email scanners, preview bots, and speculative fetches can open a
GET link before the recipient does. A third party can sign up with another
person's address and benefit from an automated scanner verifying it.

**Action**

1. Make the token-bearing GET render a generic confirmation screen without
   consuming the token.
2. Submit verification through a Server Action to the API's POST endpoint.
3. Remove state-changing GET support from the Go API and return 405 for it.
4. Keep tokens out of logs and avoid rendering them anywhere except the hidden
   POST field required for the action.
5. Preserve resend recovery for expired or already-used tokens.

**Acceptance criteria**

- GET never changes database state.
- A successful POST verifies exactly once.
- Replaying, omitting, or altering a token returns the existing safe error.
- A scanner fetching the emailed URL cannot verify the account.

**Verification**

- Handler tests for GET=405 and valid/invalid/replayed POSTs.
- Browser coverage for landing, confirmation, success, expiry, and resend.

### CGN-003 — Implement the `.edu` verified-student transition

**Priority:** P1  
**Size:** M  
**Status:** Needs product rule confirmation  
**Depends on:** `CGN-002`

**Problem**

The UI can display `verified`, but the backend never assigns it. Email
verification currently leaves every ordinary account at `basic`. The product
therefore advertises a trust signal that users cannot earn through the product.

**Action**

1. Lock the `.edu` matching rule, including subdomains, case normalization, and
   any domains that must be excluded.
2. Apply the transition in the same transaction that verifies the email.
3. Ensure staff/faculty grants are never downgraded.
4. Decide how an email change would affect the level before email changes are
   introduced.
5. Document clearly that `.edu` is a limited trust indicator, not proof of
   current enrollment or identity.

**Acceptance criteria**

- A qualifying verified address becomes `verified`.
- A non-qualifying verified address remains `basic`.
- `staff_faculty` is preserved.
- Public profiles and organizer summaries display the resulting level
  consistently.

**Verification**

- Table-driven tests for qualifying, non-qualifying, subdomain, mixed-case, and
  deceptive suffix addresses.
- PostgreSQL-backed test for the transactional state transition.
- Browser test for the public badge.

### CGN-004 — Make account lifecycle operations atomic

**Priority:** P1  
**Size:** L  
**Status:** Ready  
**Depends on:** `CGN-002`, `CGN-003`

**Problem**

Several service methods compose independently committed repository operations:
signup creates a user before creating a verification token, verification
consumes the token before marking the user verified, and profile updates replace
social links before updating the profile. A failure can return an error after
only part of the requested operation committed.

**Action**

1. Introduce a narrow transaction/unit-of-work boundary for account use cases.
2. Commit user creation and verification-token creation together.
3. Commit token consumption and account verification/level assignment together.
4. Commit profile fields and social-link replacement together.
5. Keep provider email delivery outside the database transaction; use the
   durable mechanism from `CGN-010` for delivery intent.
6. Preserve stable response error codes at the HTTP boundary; leave the broader
   typed-error refactor to `CGN-017`.

**Acceptance criteria**

- Injected failure at any database step leaves the pre-request state intact.
- Signup cannot return failure with an address silently reserved and no usable
  verification flow.
- Verification cannot consume a token without applying the account transition.
- Profile fields and links never reflect different submissions.

**Verification**

- Repository integration tests that force failure at each transaction stage.
- Service tests for commit, rollback, duplicate email, replay, and deleted user.

---

## P1 — Core discovery and event correctness

### CGN-005 — Add a reusable searchable school picker

**Priority:** P1  
**Size:** M  
**Status:** Ready  
**Depends on:** None

**Problem**

Event and team creation load only the first 100 schools alphabetically, plus the
user's home school. Most of the 6,243-school catalog cannot be selected.

**Action**

1. Build one accessible school-search picker shared by signup, event creation,
   event editing, and team creation.
2. Query the existing `/schools?q=...` API instead of embedding a fixed prefix
   of the catalog.
3. Preserve the current selection even when it is not in the latest result set.
4. Add loading, no-results, failure, keyboard, and no-JavaScript behavior.
5. Remove duplicated `withHomeSchool`/`withSchoolSummary` adapter logic after
   the picker owns selection hydration.

**Acceptance criteria**

- Any active school can be selected by name from all relevant forms.
- Initial results do not imply that only A–B schools are supported.
- Current home/host school remains visible and selected on load.
- The control is usable by keyboard and assistive technology on mobile and
  desktop.

**Verification**

- Component tests for selection persistence and failure/empty/loading states.
- Playwright test selecting a school beyond the first 100 records.
- Axe and horizontal-overflow checks.

### CGN-006 — Add pagination to schools, events, and teams

**Priority:** P1  
**Size:** M  
**Status:** Ready  
**Depends on:** None

**Problem**

The APIs expose `limit` and `offset`, but browse pages always request the first
page and render no navigation. Records after the first 25 are undiscoverable.

**Action**

1. Prefer stable cursor pagination for events and teams; use offset pagination
   only if the product accepts duplicates/skips when rows change between pages.
2. Return explicit pagination metadata rather than inferring completion from
   list length.
3. Preserve game, school, state, query, and format filters across page links.
4. Add previous/next controls with canonical, crawlable URLs.
5. Decide whether school search needs a total count; do not add an expensive
   count query without a UI need.

**Acceptance criteria**

- Every matching record is reachable through browse navigation.
- Page boundaries are deterministic under the documented ordering.
- Filtered navigation retains every active filter.
- Invalid cursors/pages return a safe empty or validation response, not 500.

**Verification**

- Repository and HTTP tests with more than one page of results.
- Browser tests for forward/back navigation and retained filters.

### CGN-007 — Make recurrence editing honest and explicit

**Priority:** P1  
**Size:** M  
**Status:** Ready  
**Depends on:** Product decision already recorded: occurrences edit independently

**Problem**

The edit form exposes recurrence rule and end-date controls, but the Go update
model ignores them. A user can change recurrence fields, receive “Event
updated,” and see that the recurrence did not change.

**Action**

1. For the current independent-occurrence model, remove or disable recurrence
   controls on edit and state that recurrence cannot be changed after creation.
2. Reject recurrence fields at the API update boundary instead of silently
   ignoring them.
3. Ensure a child occurrence does not imply that editing it changes the series.
4. Keep edit-series behavior out of scope unless the product decision changes.

**Acceptance criteria**

- No submitted edit field is silently discarded.
- The UI accurately explains occurrence-only editing.
- API clients receive a clear validation error for unsupported recurrence
  mutation.

**Verification**

- Server Action and handler tests for recurrence fields on update.
- Browser regression test for editing a recurring occurrence.

### CGN-008 — Generate recurrences in the event's IANA timezone

**Priority:** P1  
**Size:** L  
**Status:** Needs product rule confirmation  
**Depends on:** `CGN-007`

**Problem**

Recurring timestamps are generated from the fixed offset embedded in the input
timestamp. The separate IANA timezone is validated but not used for occurrence
generation. Weekly events can move by an hour across daylight-saving
transitions. Monthly events also lose their original day anchor after clamping
to a short month, such as January 31 → February 28 → March 28.

**Action**

1. Convert the initial local wall-clock time into the supplied IANA location
   before generating occurrences.
2. Define DST behavior for nonexistent and repeated local times.
3. Preserve the original monthly day anchor and clamp each occurrence from that
   anchor rather than from the previously clamped date.
4. Preserve event duration intentionally across DST; document whether duration
   or local end time wins.
5. Backfill only if recurring production data exists when this ships.

**Acceptance criteria**

- A weekly 7:00 PM event remains at 7:00 PM local time across DST.
- A monthly event anchored on the 29th, 30th, or 31st returns to that day when a
  later month supports it.
- Start/end behavior at both DST boundaries is documented and tested.
- Stored timestamps and displayed timezone agree.

**Verification**

- Table-driven tests for spring/fall DST in multiple US zones.
- Leap-year and month-end tests covering at least 12 occurrences.
- PostgreSQL-backed series creation test that reads every stored occurrence.

### CGN-009 — Replace raw timestamp entry with usable date/time controls

**Priority:** P1  
**Size:** M  
**Status:** Ready  
**Depends on:** `CGN-008`

**Problem**

The event form asks users to type ISO timestamps and an IANA timezone manually.
That is technically precise but error-prone and inappropriate for the primary
creation journey.

**Action**

1. Use accessible local date/time controls for start and end.
2. Default the timezone from the profile/browser and provide a curated timezone
   selector with search or a clear fallback.
3. Convert local values to offset-bearing timestamps at the server boundary.
4. Handle DST ambiguity using the rules established in `CGN-008`.
5. Preserve native validation and no-JavaScript submission where practical.

**Acceptance criteria**

- Users never need to know ISO 8601 or type an IANA identifier for the common
  case.
- Submitted timestamps round-trip to the same displayed local time.
- Mobile browsers receive appropriate date/time controls.

**Verification**

- Unit tests for local-time conversion and DST edges.
- Desktop/mobile browser tests for create and edit.

---

## P1/P2 — Side-effect and runtime reliability

### CGN-010 — Bound email requests and persist delivery intent

**Priority:** P1  
**Size:** L  
**Status:** Ready  
**Depends on:** `CGN-004`

**Problem**

Account email falls back to `http.DefaultClient` without a client timeout.
Cancellation email runs in an untracked goroutine and sends every recipient
sequentially under one ten-second deadline. A slow provider can hold handlers,
and process restarts or larger attendee lists can lose notifications. Repeating
a `yes` RSVP can also send duplicate confirmations because delivery is not keyed
to a state transition.

**Action**

1. Immediately provide an HTTP client with connect, response-header, and overall
   timeouts to both mailers.
2. Add a transactional outbox table and worker for verification, reset, RSVP,
   cancellation, and account-deletion cancellation mail.
3. Write delivery intent in the same transaction as the domain state change.
4. Add idempotency keys so retries do not duplicate email.
5. Track attempts, next-attempt time, terminal failure, and provider message ID.
6. Bound worker concurrency and use per-message deadlines.
7. Expose failure counts through logs/metrics without logging tokens or message
   bodies.

**Acceptance criteria**

- No provider request can run without a deadline.
- A committed domain change always leaves durable delivery intent.
- Restarting the API during delivery does not lose or duplicate mail.
- Re-submitting an unchanged `yes` RSVP does not send another confirmation.
- Every active yes/maybe attendee is independently retried after cancellation.

**Verification**

- Mailer tests for timeout and non-2xx behavior.
- PostgreSQL-backed outbox commit/rollback/idempotency tests.
- Worker tests for retry, restart, concurrency, and poison messages.

### CGN-011 — Decouple public pages from mandatory session lookup

**Priority:** P2  
**Size:** M  
**Status:** Ready  
**Depends on:** None

**Problem**

The root layout fetches `/me` for every route. This makes all pages dynamically
rendered and causes an API outage to break About, FAQ, Terms, and Privacy even
though those pages contain static content. It also adds a network and database
session lookup to every authenticated navigation.

**Action**

1. Separate public/static and authenticated route-layout responsibilities, or
   move the personalized navigation into a small dynamic boundary.
2. Do not call `/me` when no session cookie is present.
3. Let public navigation degrade to logged-out state on API failure while
   authenticated pages continue to fail explicitly.
4. Measure the resulting static/dynamic route output and request count.

**Acceptance criteria**

- About, FAQ, Terms, and Privacy render when the API is unavailable.
- Logged-out public requests make no `/me` call.
- Authenticated navigation still displays the correct account state.
- The production build identifies static routes as static where intended.

**Verification**

- Route tests with the API unavailable and with/without a session cookie.
- Production-build route report checked into the change description.

### CGN-012 — Stop writing `last_seen_at` on every authenticated API call

**Priority:** P2  
**Size:** S  
**Status:** Ready  
**Depends on:** `CGN-011` recommended

**Problem**

Session lookup performs an `UPDATE auth_sessions` on every successful request.
Pages that compose several API calls generate several writes. A failure to touch
`last_seen_at` also rejects an otherwise valid session and can clear the cookie.
The timestamp does not currently control the fixed session expiry.

**Action**

1. Decide whether `last_seen_at` has an operational or security consumer.
2. If not, stop updating it during lookup.
3. If it is needed, update it only after a threshold, such as once per hour, and
   do not fail authentication when the best-effort touch fails.
4. Add an index or cleanup rule only if a real query requires one.

**Acceptance criteria**

- Repeated authenticated reads do not produce one database write per request.
- A best-effort activity timestamp failure cannot log out a valid user.
- Session expiry behavior remains unchanged unless explicitly redesigned.

**Verification**

- Repository test that counts writes across repeated lookups.
- Middleware test for a valid session when the optional touch fails.

### CGN-013 — Fail closed on unsafe production configuration

**Priority:** P1  
**Size:** S  
**Status:** Ready  
**Depends on:** None

**Problem**

Safe production cookie, site URL, and email settings are documented but not
validated at startup. A production deployment can start with insecure cookies,
a localhost link base, or no mail provider key and then report email success
while only logging a local link.

**Action**

1. Add an explicit environment mode or an equivalent production-safety switch.
2. In production, require HTTPS `API_SITE_URL`, secure cookies, a non-default
   database URL, and the required Resend/from-address settings.
3. Keep deliberate local defaults available only outside production.
4. Validate URLs, cookie names, positive durations, and sender addresses.

**Acceptance criteria**

- Unsafe production configuration exits before accepting traffic with a clear,
  non-secret error.
- Local Docker Compose still starts without external provider credentials.
- Staging can opt into production-strength validation.

**Verification**

- Table-driven configuration tests for local, staging, valid production, and
  every invalid production setting.

### CGN-014 — Distinguish empty results from upstream failure

**Priority:** P2  
**Size:** S  
**Status:** Ready  
**Depends on:** `CGN-011` recommended

**Problem**

Several public pages catch every API error and replace it with an empty list.
Users see “no results” when the service is actually unavailable, and contract
violations become invisible outside server logs.

**Action**

1. Model success-empty, expected not-found, transient unavailable, and contract
   failure as separate UI states.
2. Preserve useful degraded content on the homepage.
3. Give browse pages a retry path and a truthful unavailable message.
4. Send unexpected failures to the monitoring work tracked for launch.

**Acceptance criteria**

- A valid empty query and an unreachable API render different messages.
- Contract violations reach structured error reporting without response data.
- Public pages retain a usable navigation/retry path.

**Verification**

- Page/component tests for empty, unavailable, malformed, and success states.

---

## P1 — Real-stack launch proof

### CGN-015 — Add a real BFF → Go → Postgres browser suite

**Priority:** P1  
**Size:** L  
**Status:** Ready  
**Depends on:** `CGN-001` through `CGN-010`, plus `CGN-013`

**Problem**

The browser suite exercises Next.js against a fake API. Go has strong handler
and repository coverage, and CI runs PostgreSQL-backed tests, but no automated
test proves the complete browser/BFF/API/database integration. Proxy identity,
cookie mirroring, migrations, transactions, and real serialization can regress
between otherwise green suites.

**Action**

1. Add a CI job that starts disposable Postgres, applies migrations, seeds a
   small deterministic fixture, and starts the real Go API and Next.js app.
2. Reuse a focused subset of the current Playwright journeys rather than
   duplicating every fake-API test.
3. Cover signup → POST verification → login, school selection, event creation,
   private unlock, RSVP, team join, account deletion, and rate-limit identity.
4. Keep the fake API suite for fast deterministic UI/error-state coverage.
5. Add a provider stub at the HTTP boundary for Resend; exercise real outbox and
   serialization without sending public email in CI.

**Acceptance criteria**

- CI fails on cookie, proxy-header, migration, API-contract, or database-shape
  drift across the full stack.
- Tests are isolated and repeatable locally and in CI.
- The suite has a documented command and cleanup behavior.

**Verification**

- The new real-stack job passes from a clean checkout twice consecutively.
- Existing unit, handler, repository, fake-API browser, and build jobs remain.

### Existing launch gates that remain P1

These were not created by the review and remain required alongside `CGN-015`:

- Replace placeholder Terms and Privacy content and persist versioned signup
  acceptance.
- Decide Gravatar disclosure, default, and opt-out behavior.
- Notify active yes/maybe attendees when account deletion archives their event.
- Confirm retention windows, legal-hold ownership, and the manual purge runbook.
- Configure staging/production, backups, restore rehearsal, DNS, real Resend,
  monitoring, and the manual smoke checklist in [13 — Deployment plan](./13-deployment-plan.md).

Do not treat a green local test suite as completion of these external launch
gates.

---

## P2/P3 — Product completeness and maintainability

### CGN-016 — Complete or explicitly defer multi-organizer management

**Priority:** P2  
**Size:** L  
**Status:** Needs product rule confirmation  
**Depends on:** Site-admin and notification direction

**Problem**

The schema, public event response, and account-deletion succession logic support
multiple organizers, but ordinary users cannot add or remove one. The domain is
partially implemented and product documentation implies multi-organizer support.

**Action**

1. Confirm whether organizer management is required for the first release.
2. If yes, define invitation/acceptance, permissions, removal, creator transfer,
   notification, and last-organizer rules before implementing endpoints/UI.
3. If no, change launch documentation and UI language so support is not implied;
   retain the schema only as internal preparation.

**Acceptance criteria**

- Product promise and reachable functionality agree.
- Direct API authorization covers every organizer transition.
- Account deletion and cancellation behavior remain deterministic.

**Verification**

- State-transition and authorization matrix tests if implemented.

### CGN-017 — Replace string-matched errors with typed errors

**Priority:** P2  
**Size:** M  
**Status:** Ready  
**Depends on:** `CGN-004` recommended

**Problem**

HTTP handlers classify validation failures by searching arbitrary error text for
words such as `required`, `valid`, and `allowed`. Wording changes can alter HTTP
status and error code, and internal errors can be misclassified.

**Action**

1. Introduce typed validation, not-found, conflict, authentication, and
   authorization errors with stable machine codes.
2. Centralize error-to-HTTP mapping.
3. Wrap errors with context while preserving `errors.Is`/`errors.As` behavior.
4. Keep internal detail out of responses and sensitive payloads out of logs.

**Acceptance criteria**

- HTTP behavior does not depend on error-message wording.
- Every documented API error has one stable mapping and regression test.
- Unexpected errors consistently return the generic fallback code.

**Verification**

- Table-driven mapper tests plus existing handler contract suite.

### CGN-018 — Split growing modules by capability

**Priority:** P3  
**Size:** L  
**Status:** Ready  
**Depends on:** Complete behavior fixes first to avoid mixing refactor and semantics

**Problem**

`events.go`, `app/actions.ts`, and `router_test.go` have become large mixed-
responsibility files. Adding CRM/admin or another major domain will increase
merge risk and make ownership and review harder.

**Action**

1. Split event validation/types, commands, queries, scanning, recurrence, and
   persistence helpers while keeping the package boundary stable.
2. Split Server Actions by account, schools, events, teams, and safety.
3. Split router tests by route family and shared fixture helpers.
4. Avoid introducing abstract framework layers; organize around current use
   cases and keep narrow interfaces.

**Acceptance criteria**

- No behavior or public contract changes in the refactor.
- Focused tests can be located by domain without searching a multi-thousand-line
  file.
- Package dependency direction remains Go domain/API and Next BFF/UI.

**Verification**

- Full Go/web/unit/browser/build suite unchanged before and after.

### CGN-019 — Establish one canonical status source and repair doc drift

**Priority:** P2  
**Size:** M  
**Status:** Ready  
**Depends on:** None

**Problem**

The documentation is thoughtful but duplicated. Drift already exists: the API
doc says profile updates include majors/graduation and says deleted organizers'
events remain published, while the code implements neither claim and now
transfers or archives events. Toolchain versions and completion state also
appear in multiple files.

**Action**

1. Declare one canonical owner for product rules, API contracts, engineering
   decisions, and delivery status; make other docs link instead of restating.
2. Audit `00`, `04`, `05`, `06`, `10`, `11`, `13`, `15`, and `16` against the
   current implementation.
3. Correct account-deletion, profile, verification, recurrence, and Go-version
   drift.
4. Add a lightweight review checklist for code changes that alter documented
   behavior.
5. Consider generating endpoint/contract reference from code only if it reduces
   maintenance rather than adding another source.

**Acceptance criteria**

- No current endpoint is documented with unsupported fields or behavior.
- Each mutable status fact has one source of truth.
- Re-entry docs link directly to this backlog while review items remain open.

**Verification**

- Manual endpoint/doc audit recorded in the completion change.
- Link check across `docs/`.

### CGN-020 — Fix query-string notice semantics

**Priority:** P2  
**Size:** S  
**Status:** Ready  
**Depends on:** None

**Problem**

Some failed event notices render with success styling, and unknown query-string
values can render an empty alert. This makes failure feedback untrustworthy and
is not covered by the primary happy-path browser suite.

**Action**

1. Represent notices as a typed allowlist of message and severity.
2. Mark every `*-failed` state as danger.
3. Render nothing for unknown or empty notice values.
4. Share the pattern across event, team, school, login, and account pages.

**Acceptance criteria**

- Success and failure notices always use the correct accessible status.
- Arbitrary query values never create blank UI.

**Verification**

- Component/page tests for every known and unknown notice value.

---

## Review strengths to preserve

These are not backlog items. Future changes should not weaken them.

- Go owns authorization, persistence, state transitions, and domain validation.
- The Next.js BFF validates successful Go responses with Zod.
- Browser auth uses opaque, hashed, server-side sessions rather than JWTs.
- Passwords and shared event/team secrets use parameterized Argon2id hashes.
- SQL is parameterized, request bodies are bounded, and private-event details
  are withheld before unlock.
- Capacity-changing RSVP writes lock the event row.
- Multi-row event, team, account-deletion, operations, and password-reset changes
  use transactions where currently implemented.
- Database migrations are versioned, transactional, and deployed before the API.
- Containers run as non-root users; readiness and liveness are separate.
- CI covers Go formatting/vet/tests, PostgreSQL-backed repository tests, web
  typecheck/lint/unit tests, Playwright, and production build.
- Browser tests cover desktop/mobile layouts and automated WCAG A/AA checks.
- Catalog caching and index removal were measured rather than guessed.
- Large later features remain deferred until the current event/team loop earns
  further investment.

## Review verification baseline

The 2026-09-05 review produced this local baseline:

- Passed: Go formatting, `go vet ./...`, `go test ./...`, and `go test -race ./...`.
- Passed: web typecheck, oxlint, 44 Node unit tests, and a production build using
  webpack.
- Not exercised locally: PostgreSQL-backed tests, because `API_DATABASE_URL`
  was unset. CI is configured to run them against migrated PostgreSQL.
- Not exercised locally: Playwright, because the review host prohibited binding
  the fixture's local ports.
- The default Turbopack build hit the same host port-binding restriction; the
  webpack build completed successfully, so this was not treated as an
  application build failure.

Re-establish this baseline, plus the new acceptance tests, after every work
batch.
