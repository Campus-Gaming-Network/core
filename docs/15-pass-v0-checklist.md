# 15 — Pass v0 quality checklist

Quality regression checklist for the primary events-and-teams loop on `next`.
Tracks web-side request coverage at the BFF→Go boundary. Cross-service status and
payload integration remains deferred. Product status still lives in
[10 — Delivery status](./10-delivery-status.md).

**Owner:** Quality  
**Branch baseline:** `next` @ post-#12 (`d47d243`)  
**Harness:** web `node:test` for request contracts; Playwright with an isolated
API fixture where browser and server-rendered state matter.

**Locked web request surface (method, path, body/header shape):**

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
- [x] Production request builders for the locked routes (`apps/web/lib/pass-v0-requests.ts`)
- [x] Request-shape regression coverage (`apps/web/tests/pass-v0-contracts.test.ts`)
- [x] Non-2xx parsing and user-message coverage for Pass v0 error codes
- [x] Existing payload builders for event/RSVP/unlock/team join (`action-payloads.test.ts`)
- [x] Existing client helpers incl. role indicators (`cgn-api.test.ts`)
- [ ] Cross-service integration for exact Go status and payload shapes
- [x] Playwright/Next harness: private unlock cookie → login → RSVP
- [x] Playwright: dashboard composition (`upcoming_rsvps` + followed-school + teams)
- [x] Desktop/mobile Chromium projects with automated WCAG A/AA scans
- [ ] Expand server-action integration to the remaining primary journeys

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
- Manual mobile + assistive-technology pass on the same journeys
- Real Terms/Privacy content
- `school_admins` grant path (CRM later; indicators read-only today)
- Thin Go tests for `populateOrganizers` / `listRoleIndicators` (API)

---

## Notes for API

- Web cancel uses `DELETE /events/:slug` (not a `/cancel` path).
- Ownership transfer uses `POST /teams/:slug/transfer-ownership`.
- Ping Quality on any 4xx/5xx or error-shape drift against the table above.
