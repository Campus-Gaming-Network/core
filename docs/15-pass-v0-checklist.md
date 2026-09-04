# 15 — Pass v0 quality checklist

Quality regression checklist for the primary events-and-teams loop on `next`.
Tracks coverage against the locked BFF→Go contract surface. Product status still
lives in [10 — Delivery status](./10-delivery-status.md).

**Owner:** Quality  
**Branch baseline:** `next` @ post-#12 (`d47d243`)  
**Harness:** web `node:test` suite first; thin Playwright only where browser state
matters (private unlock cookie, dashboard composition). Playwright is deferred.

**Locked contract surface (assert status + error `code` / user message):**

| Journey | Routes |
|---------|--------|
| Signup | `POST /auth/signup`, `POST /auth/resend-verification` |
| Event create | `POST /events`, `POST /events/:slug/unlock`, `DELETE /events/:slug` (cancel) |
| RSVP | `POST /events/:slug/rsvp`, `POST\|DELETE /events/:slug/interest` |
| Team join | `POST /teams/:slug/join`, `POST /teams/:slug/transfer-ownership` |
| Dashboard | `GET /me/events`, `GET /me/teams` |

Failure cases to keep green: `rate_limited`, `event_full`, `invalid_private_password`,
`private_event_locked`, validation rejects (`invalid_request` / blocked-language).

---

## Coverage status

### Web suite (this pass)

- [x] Checklist checked in (`docs/15-pass-v0-checklist.md`)
- [x] Contract request shapes for the locked routes (`apps/web/tests/pass-v0-contracts.test.ts`)
- [x] Failure mapping coverage for Pass v0 codes via `userMessageForApiError`
- [x] Existing payload builders for event/RSVP/unlock/team join (`action-payloads.test.ts`)
- [x] Existing client helpers incl. role indicators (`cgn-api.test.ts`)
- [ ] Server-action integration (needs Next test harness — deferred)
- [ ] Playwright: private unlock cookie → RSVP
- [ ] Playwright: dashboard composition (`upcoming_rsvps` + followed-school + teams)

### Journey acceptance (manual / later E2E)

#### Signup
- [ ] Home school required; 18+ checkbox stored
- [ ] Verification email + resend rate limit
- [ ] Blocked-language name rejected before persistence

#### Event create
- [ ] Public create; private unlock gate; capacity; paid off-site fields
- [ ] Recurrence bounds (weekly/biweekly/monthly, ≤1 year)
- [ ] Soft cancel notifies active yes/maybe RSVPs (best-effort)

#### RSVP
- [ ] yes/no/maybe; ICS on yes; interested separate; capacity counts yes only

#### Team join
- [ ] Public page; password gate; captain/transfer smoke

#### Dashboard
- [ ] Upcoming RSVPs + followed-school events + team activity

#### Post-#12 nits
- [ ] Organizers on event detail; role indicators on profile
- [ ] Blocked terms on event/team/user/support/report forms

### Still open after Pass v0 web slice
- Mobile + a11y pass on the same journeys
- Real Terms/Privacy content
- `school_admins` grant path (CRM later; indicators read-only today)
- Thin Go tests for `populateOrganizers` / `listRoleIndicators` (API)

---

## Notes for API

- Web cancel uses `DELETE /events/:slug` (not a `/cancel` path).
- Ownership transfer uses `POST /teams/:slug/transfer-ownership`.
- Ping Quality on any 4xx/5xx or error-shape drift against the table above.
