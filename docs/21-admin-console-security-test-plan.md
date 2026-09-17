# 21 — Admin Console v1 security acceptance and test plan

Status: Draft implementation gate

Scope: the first Admin Console release for **site administrators only** at
`https://admin.campusgamingnetwork.com`.

This plan is the security acceptance contract for the Admin Console. A control
is not complete because the UI hides an action. It is complete only when the
Go API enforces it, the relevant automated tests pass, and the staging smoke
check proves that the deployed boundary behaves the same way.

## Repository baseline at the start of v1 work

The existing code provides useful patterns, but none should be mistaken for an
admin boundary:

- Public authentication uses `auth_sessions` and a configurable
  `cgn_session`; its default is 30 days and its cookie is `SameSite=Lax`.
  Admin sessions therefore need separate storage, configuration, middleware,
  and cookie handling rather than a flag on the public session.
- The public TanStack app already strips browser-supplied internal headers,
  forwards only its named session cookie, applies exact-origin CSRF to server
  functions, and has no-store/security-header helpers. The Admin app can reuse
  the patterns, not its cookie or proxy secret, and must also cover ordinary
  route actions/uploads.
- `internal/operations` already updates report/support queues and inserts their
  audit history transactionally. Its database tests include an audit-failure
  rollback case. Those repositories are not exposed as admin HTTP routes yet.
- `audit_logs` is application-append-only by convention today, but the initial
  migration does not establish the separate runtime database role required to
  enforce tamper resistance at PostgreSQL.
- The current deployment design keeps the Go API and PostgreSQL private. The
  Admin BFF must preserve that topology and add origin-side Cloudflare Access
  JWT validation.

## Security boundary and assumptions

```text
operator browser
  -> Cloudflare Access
  -> apps/admin (TanStack Start Admin BFF)
  -> private /admin/v1/* Go API
  -> PostgreSQL / object storage
```

The following are release invariants:

- `apps/admin` is the only public origin that can initiate an Admin Console
  browser session. The Go API and PostgreSQL have no public domain or TCP
  proxy.
- Cloudflare Access is an outer identity gate. The Admin BFF validates the
  Access JWT itself; merely reaching a Railway origin is not trusted.
- Admin authentication uses a separate opaque, server-side session. A public
  `cgn_session` is never accepted as an admin credential.
- The Admin BFF calls `/admin/v1/*` with a dedicated trust secret that is not
  shared with `apps/web`. Browser-supplied internal trust headers are removed.
- Every `/admin/v1/*` endpoint performs a capability check in Go. UI checks and
  BFF checks are usability/defense-in-depth controls only.
- Admin mutations and their audit entries commit in one database transaction.
- Every Admin Console response, including redirects and errors, is private and
  non-cacheable.
- V1 excludes impersonation, feature flags, arbitrary SQL/query consoles,
  arbitrary HTML announcements, unrestricted exports, and bulk mutations.

The initial session values are part of the v1 contract:

| Setting                                 |                                           Required value |
| --------------------------------------- | -------------------------------------------------------: |
| Cookie name                             |                               `__Host-cgn_admin_session` |
| Idle timeout                            |                                               30 minutes |
| Absolute timeout                        |                                                  8 hours |
| Recent-auth window for critical actions |                                               10 minutes |
| Cookie attributes                       | `Secure; HttpOnly; SameSite=Strict; Path=/`; no `Domain` |

Timeouts may later become stricter. Relaxing them requires an explicit security
decision and corresponding changes to this plan.

## Test layers and target locations

Use the lowest layer that can prove a property, then add an end-to-end test for
the seams between trust boundaries.

| Layer                   | Purpose                                                                                               | Likely target                                                                                                                            |
| ----------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Go unit                 | Capability, session, JWT-claim, rate-limit, validation, and header behavior with injected clocks/keys | `apps/api/internal/adminaccess`, `apps/api/internal/adminsession`, `apps/api/internal/httpapi`, `apps/api/internal/adminuploads`         |
| Go database integration | Grants, session hashes/expiry/revocation, transactional audit, append-only constraints                | `apps/api/internal/adminaccess/*_db_test.go`, `apps/api/internal/adminsession/*_db_test.go`, `apps/api/internal/operations/*_db_test.go` |
| TypeScript unit         | Admin BFF header/cookie allowlists, exact-origin CSRF, DTO allowlists, safe presentation              | `apps/admin/tests/*.test.ts`                                                                                                             |
| Browser E2E             | Browser cookie behavior, stored-XSS resistance, navigation, no caching, role outcomes                 | `apps/admin/tests/e2e/*.spec.ts`                                                                                                         |
| Real-stack E2E          | Admin BFF to private Go API trust boundary and PostgreSQL transactions                                | `apps/admin/tests/e2e-real/*.spec.ts`                                                                                                    |
| Deployment smoke        | Cloudflare, DNS, Railway origin isolation, production headers/secrets, rollback                       | staging and production runbook                                                                                                           |

All security-sensitive code must accept injectable clocks, JWT key sources, and
rate-limit stores in tests. Tests must not use sleeps to cross expiry windows.

## Required actor fixtures

Every authorization suite uses stable fixtures with distinct users and
sessions. A role is never inferred from email domain or Cloudflare membership.

| Fixture              | Database state                                                                | Expected admin result                                                        |
| -------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `anonymous`          | No public or admin session                                                    | `401 authentication_required` from the admin API                             |
| `public_user`        | Valid public `cgn_session`; no site grant                                     | Public cookie alone is ignored; no admin session is issued                   |
| `ordinary_user`      | Verified user, passes Access, no elevated grant                               | Admin session bootstrap is denied `403`; no session cookie                   |
| `school_admin_only`  | Active `school_admins` row; no site grant                                     | Same result as ordinary user; school scope never crosses into the console    |
| `revoked_site_admin` | Historical site-admin grant with `revoked_at`; token issued before revocation | Request is `401`, cookie is cleared, and no handler/repository mutation runs |
| `active_site_admin`  | Active site-admin grant and valid admin session                               | Only actions backed by an assigned capability succeed                        |
| `expired_admin`      | Active grant; idle or absolute expiry has passed                              | `401`, cookie cleared, no session refresh                                    |

For Go middleware unit tests, add a synthetic principal with only one capability
at a time. This makes it possible to prove endpoint-to-capability mapping even
though the v1 `site_admin` role receives the complete v1 capability set.

## Capability-to-endpoint contract

Keep the role-to-capability mapping in reviewed Go code. Route registration
must name the required capability; handlers must not select their own role by
string or depend on a frontend-provided role.

The exact resource path may be refined during implementation, but every v1
operation must appear in this registry and its generated test table before it
can ship.

| Capability             | V1 operations                                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------------ |
| `admin.session.read`   | `GET /admin/v1/session`                                                                                      |
| `reports.read`         | `GET /admin/v1/reports`, `GET /admin/v1/reports/{id}`                                                        |
| `reports.manage`       | `PATCH /admin/v1/reports/{id}` for assignment, status, and resolution                                        |
| `support.read`         | `GET /admin/v1/support-tickets`, `GET /admin/v1/support-tickets/{id}`                                        |
| `support.manage`       | `PATCH /admin/v1/support-tickets/{id}` for assignment, status, and resolution                                |
| `users.read`           | `GET /admin/v1/users`, `GET /admin/v1/users/{id}` with bounded search/fields                                 |
| `users.manage_status`  | `POST /admin/v1/users/{id}/suspend`, `POST /admin/v1/users/{id}/reactivate`                                  |
| `trust_grants.manage`  | `PATCH /admin/v1/users/{id}/trust-grants` for supported named grants only                                    |
| `schools.read`         | `GET /admin/v1/schools`, `GET /admin/v1/schools/{id}`                                                        |
| `schools.manage`       | `POST /admin/v1/schools`, `PATCH/DELETE /admin/v1/schools/{id}`, and named deactivate/reactivate operations  |
| `school_logos.manage`  | `POST/DELETE /admin/v1/schools/{id}/logo`                                                                    |
| `games.manage`         | `GET/POST /admin/v1/games`, `PATCH/DELETE /admin/v1/games/{id}`                                              |
| `school_grants.manage` | `GET/POST /admin/v1/schools/{id}/admin-grants`, `POST /admin/v1/schools/{id}/admin-grants/{grant_id}/revoke` |
| `site_grants.manage`   | `GET/POST /admin/v1/site-admin-grants`, `POST /admin/v1/site-admin-grants/{id}/revoke`                       |
| `audit.read`           | `GET /admin/v1/audit` using bounded entity filters and an opaque cursor                                      |

`site_grants.manage`, user-status changes, and destructive school/game actions require
authentication within the last 10 minutes. V1 must prevent an administrator
from revoking their own last active site-admin grant unless another active site
administrator remains. Bootstrap and recovery stay CLI-only and are audited.

### Authorization test matrix

Run the following data-driven table against **every** registered admin route,
not just one representative route:

| Principal/request                                                          | Expected result                                                             |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| No admin cookie                                                            | `401`; safe body; no resource lookup or mutation                            |
| Valid public-site cookie only                                              | `401`; public cookie not forwarded/accepted                                 |
| Malformed, unknown, revoked, idle-expired, or absolute-expired admin token | `401`; admin cookie deletion returned                                       |
| Ordinary or school-admin-only identity at bootstrap                        | `403`; no admin session created                                             |
| Active admin without the route capability                                  | `403`; no resource lookup or mutation                                       |
| Active admin with the route capability                                     | Allowed, subject to validation/resource state                               |
| Active admin with stale recent-auth time on a critical endpoint            | `403 recent_auth_required`; no mutation                                     |
| Active admin with capability but a different user's resource identifier    | Normal capability/resource rules; never trust actor or scope IDs from input |

The test must enumerate the runtime route registry and fail if a new
`/admin/v1/*` route has no capability declaration or no matching matrix case.
Expected status semantics are `401` for no currently valid admin identity and
`403` for a valid admin identity lacking permission/recent authentication.

## Security acceptance matrix

### A. Cloudflare Access and direct-origin resistance

| ID        | Automated/staging test                                                                                                                  | Pass condition                                                                                                                                                         | Layer                            |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| ACCESS-01 | Request the Railway Admin BFF origin directly without `Cf-Access-Jwt-Assertion`.                                                        | Request is rejected before route rendering; no admin cookie or user data; status `403` or an intentional generic `404`.                                                | Deployment smoke                 |
| ACCESS-02 | Send arbitrary text, a self-signed JWT, `alg:none`, an unknown `kid`, and a valid signature from the wrong key.                         | Every request is rejected fail-closed; no fallback to an email/header claim.                                                                                           | TS unit + real-stack             |
| ACCESS-03 | Validate signed fixtures with wrong/missing audience, wrong issuer/team domain, expired `exp`, future `nbf`, and missing subject/email. | Every invalid claim set is rejected. The configured Access application audience and issuer are exact matches.                                                          | TS unit                          |
| ACCESS-04 | Validate a correctly signed, unexpired token with the configured audience/issuer.                                                       | Identity is accepted and only the normalized immutable subject plus normalized email are retained.                                                                     | TS unit                          |
| ACCESS-05 | Exercise JWKS cache refresh with a new `kid`, key-fetch timeout, malformed JWKS, and stale keys beyond the permitted cache window.      | Rotation succeeds after one bounded refresh; fetch/parse failures deny access and never accept an unverified token.                                                    | TS unit                          |
| ACCESS-06 | Forge `Cf-Access-*`, `X-Forwarded-*`, admin principal, and internal proxy headers from the browser.                                     | BFF deletes browser values and derives replacements only from a verified Access token and server configuration.                                                        | TS unit + real-stack             |
| ACCESS-07 | Present a valid admin session while omitting or changing the Access identity.                                                           | Request is rejected. A session is bound to the Access subject used at issuance; identity switching cannot reuse it.                                                    | TS unit + browser E2E            |
| ACCESS-08 | Check the deployed Access policy.                                                                                                       | Default deny; only the approved operator group is allowed; phishing-resistant MFA is required; bypass/service-token policies are separately inventoried and justified. | Deployment smoke/manual evidence |

### B. Separate host-only admin session

| ID         | Automated test                                                                                                   | Pass condition                                                                                                                                                 | Layer                                |
| ---------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| SESSION-01 | Complete admin login/bootstrap.                                                                                  | Exactly one admin cookie is set as `__Host-cgn_admin_session=<opaque>` with `Secure`, `HttpOnly`, `SameSite=Strict`, `Path=/`, and no `Domain`.                | Go/TS unit + browser E2E             |
| SESSION-02 | Send only `cgn_session`, event-unlock cookies, or arbitrary sibling-domain cookies.                              | No admin principal is created and the Admin BFF forwards none of those cookies to the admin API.                                                               | Go + TS unit + real-stack            |
| SESSION-03 | Inspect session persistence.                                                                                     | Only SHA-256 (or stronger) token hashes are stored; raw tokens never appear in the database, audit metadata, or logs. Tokens contain at least 256 random bits. | Go database integration              |
| SESSION-04 | Attempt session fixation by supplying a chosen token before bootstrap; repeat bootstrap and recent-auth step-up. | Bootstrap and step-up rotate to a new random token; the prior token immediately fails.                                                                         | Go integration + browser E2E         |
| SESSION-05 | Advance an injected clock to just before/at/after 30 minutes idle.                                               | Activity before the boundary extends idle expiry without changing absolute expiry; at/after the boundary returns `401` and clears the cookie.                  | Go unit/database integration         |
| SESSION-06 | Advance the clock to just before/at/after 8 hours from creation while generating activity.                       | Session never survives the absolute deadline; activity cannot extend it.                                                                                       | Go unit/database integration         |
| SESSION-07 | Log out, revoke the grant, suspend/delete the account, change MFA/recovery state, or perform password recovery.  | All admin sessions for the user are invalidated immediately. Replay returns `401`; cookie is cleared.                                                          | Go database integration + real-stack |
| SESSION-08 | Create two sessions and revoke one session directly.                                                             | Revocation is token/session-specific unless the operation explicitly revokes all; no session enumeration leaks raw hashes/tokens.                              | Go database integration              |
| SESSION-09 | Open the public site and a sibling subdomain after admin login.                                                  | Browser does not send the host-only admin cookie to either host. The public cookie is not overwritten.                                                         | Browser E2E                          |
| SESSION-10 | Send state-changing requests with a valid token after its grant is revoked but before token expiry.              | Per-request active-grant lookup denies the request; cached authorization cannot outlive revocation.                                                            | Go database integration + real-stack |

Session `last_seen_at` and the effective idle deadline are updated during each
successful authenticated request. Admin traffic is intentionally low in v1;
correct revocation and expiry evidence takes priority over write coalescing.

### C. Exact-origin CSRF

The only accepted production origin is exactly
`https://admin.campusgamingnetwork.com`. Do not derive the accepted origin from
`Host`, `X-Forwarded-Host`, or another request header.

| ID      | Automated test                                                                                                                                                                              | Pass condition                                                                                                                                | Layer                 |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| CSRF-01 | POST/PATCH/PUT/DELETE with the exact configured `Origin`.                                                                                                                                   | Request reaches authentication/authorization.                                                                                                 | TS unit + browser E2E |
| CSRF-02 | Repeat mutations with missing `Origin`, `Origin: null`, multiple Origin values, malformed origin, wrong scheme, an unexpected port, attacker domain, and `https://campusgamingnetwork.com`. | Every request is `403 csrf_rejected` before BFF/API side effects.                                                                             | TS unit               |
| CSRF-03 | Use sibling and lookalike origins: `www.campusgamingnetwork.com`, `evil.campusgamingnetwork.com`, `admin.campusgamingnetwork.com.evil.test`, and a URL with user-info.                      | Every request is rejected. Suffix matching is never used.                                                                                     | TS unit + real-stack  |
| CSRF-04 | Submit cross-origin `application/x-www-form-urlencoded`, `multipart/form-data`, `text/plain`, and JSON requests.                                                                            | All content types are covered; a “simple” request does not bypass CSRF checks.                                                                | TS unit + browser E2E |
| CSRF-05 | Forge `Host`/forwarded-host headers while using an attacker Origin.                                                                                                                         | Rejected against configured origin.                                                                                                           | TS unit               |
| CSRF-06 | Enumerate GET/HEAD admin routes and assert no state changes, including session/grant timestamps other than a documented session touch.                                                      | Safe methods remain read-only; no mutation is hidden behind query parameters.                                                                 | Go integration        |
| CSRF-07 | Reject a mutation and inspect downstream spies/database.                                                                                                                                    | Access, CSRF, authentication, capability, and recent-auth gates execute before handler mutation; rejected request creates no domain mutation. | TS/Go integration     |

SameSite cookies are defense in depth and are not the CSRF decision. If a
framework CSRF middleware does not cover ordinary route actions as well as
server functions, add an Admin BFF request middleware that does.

### D. Capability enforcement and identifier safety

| ID       | Automated test                                                                                  | Pass condition                                                                                                                          | Layer                        |
| -------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| AUTHZ-01 | Execute the actor matrix against every admin route.                                             | All results match the authorization table above; zero route omissions.                                                                  | Go table test                |
| AUTHZ-02 | Execute each route with every single-capability principal.                                      | Only the declared capability permits access. Read capability never permits write.                                                       | Go table test                |
| AUTHZ-03 | Tamper with actor IDs, assignee IDs, school IDs, user IDs, and role names in path/body/query.   | Actor comes only from session context; identifiers are validated; nonexistent/inaccessible resources do not disclose extra information. | Go integration               |
| AUTHZ-04 | Ask a school admin to grant/revoke site or school roles through every route variant.            | Denied. School-admin scope has no implicit Admin Console capability.                                                                    | Go integration + browser E2E |
| AUTHZ-05 | Race two last-admin revocations and self-revocation.                                            | Database transaction/constraint leaves at least one active site admin; one conflicting operation fails safely.                          | Go database integration      |
| AUTHZ-06 | Add a new admin route in a test fixture without a capability declaration.                       | Route-registry coverage test fails.                                                                                                     | Go unit                      |
| AUTHZ-07 | Supply unsupported filter fields, excessive page sizes, unbounded dates, and malformed cursors. | Stable `400` errors; max page size enforced; no arbitrary sort/column/SQL fragments accepted.                                           | Go unit/integration          |

### E. Dedicated Admin BFF-to-API trust boundary

| ID       | Automated test                                                                                                                                                         | Pass condition                                                                                                                                                                                                     | Layer                            |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------- |
| TRUST-01 | Start staging/production configuration without `ADMIN_API_PROXY_SHARED_SECRET`, with a value under 32 characters, or with the same value as `API_PROXY_SHARED_SECRET`. | Startup fails with a field-specific error that never includes secret values.                                                                                                                                       | Go + TS config unit              |
| TRUST-02 | Call `/admin/v1/*` with no secret, wrong secret, the public-web secret, duplicate headers, or a browser-forged header.                                                 | Rejected before authentication/handler work; comparison is constant-time; response is generic.                                                                                                                     | Go unit + real-stack             |
| TRUST-03 | Call with the dedicated server-injected secret over the private network.                                                                                               | Request proceeds to admin session/authz. Secret is never serialized to the browser.                                                                                                                                | Real-stack                       |
| TRUST-04 | Inspect BFF forwarding for cookies and headers.                                                                                                                        | Only the named admin cookie and an explicit allowlist of request metadata are forwarded. Authorization, Cloudflare JWT, public cookies, and arbitrary client headers are not forwarded unless explicitly required. | TS unit                          |
| TRUST-05 | Request an admin API path through `apps/web` or the public API hostname.                                                                                               | No proxy route exists; response is `404`/deny.                                                                                                                                                                     | TS unit + deployment smoke       |
| TRUST-06 | Inspect Railway networking.                                                                                                                                            | Go API has no public domain/TCP proxy and private HTTP is used only inside the environment.                                                                                                                        | Deployment smoke/manual evidence |

Secret rotation must support a bounded two-secret overlap (`current` and
`previous`) or a coordinated no-downtime deployment. After the overlap, the old
secret must fail a smoke test.

### F. Transactional audit and tamper resistance

| ID       | Automated test                                                                                                      | Pass condition                                                                                                                                                                                   | Layer                                   |
| -------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------- |
| AUDIT-01 | Run every admin mutation successfully.                                                                              | One corresponding audit row is committed with actor user ID, admin session ID (non-secret identifier), action, entity type/ID, request ID, required reason, and allowlisted before/after fields. | Go database integration                 |
| AUDIT-02 | Force audit insertion to fail after the domain update is attempted.                                                 | Entire transaction rolls back; domain and audit tables are unchanged.                                                                                                                            | Go database integration                 |
| AUDIT-03 | Force the domain update to fail.                                                                                    | No success audit row is written. A separate bounded security/failure event may be logged without claiming the mutation succeeded.                                                                | Go database integration                 |
| AUDIT-04 | Attempt `UPDATE`, `DELETE`, and truncate-equivalent operations on `audit_logs` using the runtime API database role. | Database denies them. Runtime role can insert/read only what the application requires; migration/maintenance credentials are separate.                                                           | Database integration + deployment smoke |
| AUDIT-05 | Send passwords, cookies, Access JWTs, proxy secrets, raw session values, upload bytes, and unexpected body fields.  | None appears in audit JSON. Before/after data is constructed from field allowlists, not request-body serialization.                                                                              | Go integration                          |
| AUDIT-06 | Perform concurrent edits to one queue item/grant.                                                                   | Audit rows reflect committed order/version; each before state equals the previous committed after state or the write fails with a conflict.                                                      | Go database integration                 |
| AUDIT-07 | Read audit history with actor/entity filters and pagination.                                                        | Requires `audit.read`; bounded page size and stable cursor; no mutation endpoint for audit records.                                                                                              | Go integration                          |
| AUDIT-08 | Revoke a site grant or invalidate sessions.                                                                         | Actor, target, reason, and affected session count are audited without token material.                                                                                                            | Go database integration                 |

The migration suite must prove the runtime database principal is not the schema
owner or otherwise able to bypass the `audit_logs` write restrictions. A
production restore/maintenance procedure may use a separate privileged role;
that credential must not be available to the running API.

### G. Stored XSS and plain-text rendering

Use hostile strings in report/support content, resolution notes, school/game
names, usernames, filenames, and audit metadata:

```text
<script>globalThis.__xss = true</script>
<img src=x onerror=globalThis.__xss=true>
</textarea><svg/onload=globalThis.__xss=true>
javascript:alert(1)
https://safe.example/\" onmouseover=\"alert(1)
```

| ID     | Automated test                                                                                           | Pass condition                                                                                                                                                 | Layer                          |
| ------ | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| XSS-01 | Store and render each payload in every text-bearing admin component.                                     | Payload displays as text; no element/handler is created and `globalThis.__xss` remains unset.                                                                  | TS unit + browser E2E          |
| XSS-02 | Search the Admin app for HTML escape hatches and test any approved use.                                  | No unapproved `dangerouslySetInnerHTML`, raw HTML parser, inline script, or unsafe URL assignment. Any exception has sanitization tests and a documented need. | Static check + TS unit         |
| XSS-03 | Put `javascript:`, `data:`, credentials, control characters, and off-domain URLs into link/image fields. | Unsafe schemes/URLs are rejected or rendered as non-links. Logo URLs use the approved asset origin/key only.                                                   | TS + Go unit                   |
| XSS-04 | Trigger validation and server errors containing hostile values.                                          | Error UI and toast/notification paths render bounded, allowlisted text and never expose upstream errors/stacks.                                                | TS unit + browser E2E          |
| XSS-05 | Inspect production CSP and attempt inline/eval script execution.                                         | CSP has no `unsafe-eval`; inline script is nonce/hash controlled if framework-required; injected payload cannot execute.                                       | Browser E2E + deployment smoke |

### H. Cache, indexing, and security headers

Assert headers on HTML, server-function/data responses, successful downloads,
redirects, `401`, `403`, `404`, `429`, and `500` responses.

| ID        | Required assertion                                                                                                                                                                                             | Layer                          |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| HEADER-01 | `Cache-Control: private, no-store` on every Admin response; no route or service worker caches admin payloads.                                                                                                  | TS unit + browser E2E          |
| HEADER-02 | `X-Robots-Tag: noindex, nofollow, noarchive` on every response and `<meta name="robots" content="noindex,nofollow,noarchive">` on HTML.                                                                        | Browser E2E                    |
| HEADER-03 | CSP includes at least `default-src 'self'`, `base-uri 'self'`, `object-src 'none'`, `frame-ancestors 'none'`, `form-action 'self'`, and narrow `script-src`, `style-src`, `img-src`, and `connect-src` values. | TS unit + deployment smoke     |
| HEADER-04 | `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, restrictive `Permissions-Policy`, and `Referrer-Policy: no-referrer`.                                                                              | Browser E2E                    |
| HEADER-05 | Production HTTPS emits `Strict-Transport-Security`; local HTTP tests do not emit an ineffective HSTS header.                                                                                                   | Browser E2E + deployment smoke |
| HEADER-06 | Error responses contain stable public codes only, no stack, SQL text, internal URL, secret, or user enumeration detail.                                                                                        | Go + TS unit                   |
| HEADER-07 | Responses varying by session declare `Vary: Cookie` where applicable and never become shared-cacheable through a route override.                                                                               | TS unit + browser E2E          |

### I. Rate limits and abuse resistance

Use a store abstraction so tests are deterministic. A single-process limiter is
acceptable only while the Admin BFF/API each run exactly one replica; scaling
past one replica requires a shared limiter before rollout.

Initial v1 defaults:

| Bucket                                  |             Limit | Key                                |
| --------------------------------------- | ----------------: | ---------------------------------- |
| Session bootstrap/step-up failures      |  5 per 15 minutes | Access subject + trusted client IP |
| Admin reads                             |    120 per minute | Admin user + trusted client IP     |
| Admin writes                            |     30 per minute | Admin user + trusted client IP     |
| Grant changes and other critical writes | 10 per 15 minutes | Admin user + trusted client IP     |
| Logo upload attempts                    | 10 per 15 minutes | Admin user + trusted client IP     |

| ID      | Automated test                                                                                   | Pass condition                                                                                                                 | Layer               |
| ------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | ------------------- |
| RATE-01 | Send exactly N requests and then N+1 using an injected clock/store.                              | N is handled; N+1 is `429 rate_limited` with a valid `Retry-After`; no domain/audit-success mutation for the rejected request. | Go unit/integration |
| RATE-02 | Vary attacker-supplied forwarded headers while keeping the trusted Cloudflare identity/IP fixed. | Bucket cannot be evaded with spoofed headers.                                                                                  | TS/Go real-stack    |
| RATE-03 | Use two admins from one IP and one admin from two trusted IPs.                                   | Composite keys avoid one operator trivially exhausting another while still bounding distributed attempts.                      | Go unit             |
| RATE-04 | Advance through the retry boundary.                                                              | Request remains denied before and succeeds at/after reset; headers do not reveal another user's quota.                         | Go unit             |
| RATE-05 | Trigger `401`, `403`, malformed input, upload rejection, and downstream failure.                 | Attempts consume the appropriate abuse bucket; only successful writes receive success audits.                                  | Go integration      |
| RATE-06 | Set zero/negative/excessive limits or invalid windows in staging/production.                     | Startup fails safely; config errors omit configured values/secrets.                                                            | Go/TS config unit   |

### J. School-logo upload security

V1 accepts only PNG and JPEG school logos. SVG and animated/multi-frame formats
are out of scope. The server generates object keys and decodes then re-encodes
accepted images before storage.

| Constraint                   |                                            Required value |
| ---------------------------- | --------------------------------------------------------: |
| Compressed request/file size | Maximum 5 MiB; streaming body limit before full buffering |
| Decoded dimensions           |                                       Maximum 4096 x 4096 |
| Decoded pixel count          |                                     Maximum 16 megapixels |
| Output                       |       Server-re-encoded PNG or JPEG with metadata removed |

| ID        | Automated test                                                                                                                     | Pass condition                                                                                                                                              | Layer                    |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| UPLOAD-01 | Upload small valid PNG/JPEG files with incorrect extensions and honest signatures.                                                 | Decision is based on decoded bytes/signature, not filename or client MIME; output is a new server-generated key.                                            | Go unit/integration      |
| UPLOAD-02 | Upload SVG, HTML, JavaScript, GIF, WebP, ZIP, executable, polyglot, malformed/truncated image, and extension/MIME-spoofed content. | Rejected with stable `415`/`422`; nothing stored.                                                                                                           | Go unit/integration      |
| UPLOAD-03 | Send a body at, one byte over, and far over 5 MiB, including chunked transfer.                                                     | Limit is enforced while streaming; over-limit response is `413`; memory use remains bounded.                                                                | Go integration           |
| UPLOAD-04 | Decode images at/over dimension and pixel limits, including a compressed image bomb.                                               | At-limit valid image succeeds; over-limit data is rejected before expensive full decode/allocation where supported.                                         | Go unit/integration      |
| UPLOAD-05 | Include EXIF/GPS, ICC/comments, trailing script bytes, and crafted filenames/paths.                                                | Re-encoded output contains pixels only and no source metadata/trailing payload; filename/path is ignored.                                                   | Go unit                  |
| UPLOAD-06 | Force storage failure after validation and database failure after object write.                                                    | No school references a missing object; orphan object is cleaned up or placed in a documented reconciliation queue.                                          | Go integration           |
| UPLOAD-07 | Fetch the stored image.                                                                                                            | Separate approved asset origin/key, fixed image content type, `nosniff`, no cookies/HTML interpretation, and an immutable randomized URL after replacement. | Browser/deployment smoke |
| UPLOAD-08 | Attempt upload without `school_logos.manage`, with stale recent auth if classified critical, or above the upload rate limit.       | Rejected before decode/storage and leaves no object.                                                                                                        | Go integration           |

### K. Logging and error redaction

| ID     | Automated test                                                                                                                                                                                                                      | Pass condition                                                                                                                                               | Layer                   |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------- |
| LOG-01 | Put unique canaries in cookies, public/admin session tokens, Access JWT, proxy secrets, authorization headers, passwords, recovery values, upload bytes, and request bodies; exercise success, rejection, timeout, and panic paths. | Captured logs contain none of the canaries.                                                                                                                  | Go + TS unit/real-stack |
| LOG-02 | Inspect normal request logs.                                                                                                                                                                                                        | Logs include request ID, route template (not uncontrolled full URL), method, status, duration, and authenticated actor ID only after verification.           | Go + TS unit            |
| LOG-03 | Send control characters/newlines and very long values in paths, headers, and text inputs.                                                                                                                                           | Structured logs remain one event per record; values are escaped/truncated and do not forge fields.                                                           | Go + TS unit            |
| LOG-04 | Return database/object-store/internal-network errors.                                                                                                                                                                               | Client receives a stable safe code; logs retain a correlation ID and useful internal classification without credentials, SQL values, or response-body dumps. | Go integration          |
| LOG-05 | Review third-party error/analytics configuration.                                                                                                                                                                                   | Admin Console sends no session/JWT/body data and no report/support content. Prefer no third-party analytics in v1.                                           | Config/static review    |

## Deployment smoke and rollback checklist

Run the complete automated suite in CI first. Then execute this checklist in
staging with disposable fixtures. Record timestamp, commit SHA, operator, and
request IDs for evidence. Repeat the abbreviated marked items in production.

### Pre-deploy

- [ ] Database backup/PITR is healthy and a recent restore drill exists.
- [ ] Migrations are expand/contract compatible with the currently deployed
      API/Admin versions; old application code can run while the new schema exists.
- [ ] Runtime database credentials are distinct from migration credentials and
      cannot update/delete `audit_logs`.
- [ ] Admin BFF, API, and database are in one Railway environment/region; API
      and database have no public network endpoint.
- [ ] `ADMIN_API_PROXY_SHARED_SECRET` is unique per environment, differs from
      `API_PROXY_SHARED_SECRET`, and exists only in Admin BFF/API services.
- [ ] Cloudflare Access application audience, issuer/team domain, allow policy,
      phishing-resistant MFA requirement, and emergency accounts are peer-reviewed.
- [ ] At least two active site administrators/recovery operators exist before
      enabling self-service site grant changes.
- [ ] Admin app startup validation passes with production-strength settings.

### Staging smoke

- [ ] **Production repeat:** Cloudflare URL without Access authentication is
      denied; an approved phishing-resistant login reaches the console.
- [ ] **Production repeat:** direct Railway Admin origin without a JWT, with a
      forged JWT, and with copied unverified Access headers is denied.
- [ ] **Production repeat:** public `cgn_session` alone does not authenticate;
      admin login sets the exact host-only Strict cookie attributes.
- [ ] Anonymous, ordinary, school-admin-only, revoked-site-admin, and active
      site-admin fixtures produce the expected authorization results.
- [ ] Sibling-origin and missing-Origin mutations are rejected; exact-origin
      mutation succeeds.
- [ ] A queue mutation commits its audit row. A forced audit failure rolls back
      the mutation.
- [ ] Revoking the test site-admin grant invalidates its existing session on
      the next request.
- [ ] Stored-XSS fixtures display as text and do not execute.
- [ ] Oversized, SVG, malformed, and metadata-bearing uploads meet the upload
      contract; stored output is re-encoded and served safely.
- [ ] Headers are correct on success, redirect, authorization failure, rate
      limit, not-found, and injected internal-error responses.
- [ ] Rate-limit N/N+1 and `Retry-After` behavior matches configured values.
- [ ] Log search for all smoke-test secret canaries returns zero matches.
- [ ] **Production repeat:** `apps/web` and public API cannot proxy or serve an
      Admin endpoint, and the public site remains healthy.

### Rollback rehearsal

1. Deploy the previous Admin BFF/API artifact while leaving additive migrations
   in place. Confirm public web health and that Admin either remains compatible
   or is disabled fail-closed.
2. Confirm new sessions/grants created by the candidate do not cause the prior
   release to grant broader access. Unknown capability/session state must deny.
3. If the incident is authentication or authorization related, disable the
   Cloudflare Access application route or Admin Railway service first; do not
   expose a bypass page. Revoke all affected admin sessions.
4. Restore the previous secrets only through the coordinated rotation process;
   never put a retired secret back into logs, Git, or a browser response.
5. Do not down-migrate destructive schema changes during the live rollback.
   Schedule schema cleanup only after the rollback window closes and backup is
   verified.
6. Re-run direct-origin denial, public-cookie rejection, one authorized read,
   one audited write/rollback, and public-site health before declaring rollback
   complete.

## Release gates

The Admin Console v1 may ship only when all gates are true:

| Gate              | Measurable requirement                                                                                                                                    |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Automated tests   | `npm run test:api`, Admin TypeScript unit tests, Admin Playwright tests, and real-stack security tests all pass with zero retries hiding failures.        |
| Route coverage    | 100% of runtime `/admin/v1/*` routes appear in the capability registry and actor/capability test table.                                                   |
| Mutation coverage | 100% of admin mutation routes have exact-origin CSRF, capability, recent-auth (where required), rate-limit, success-audit, and audit-rollback assertions. |
| Session coverage  | Idle and absolute boundaries, rotation, logout, grant revocation, account security changes, and replay are automated with an injected clock.              |
| Response coverage | Representative HTML/data/redirect plus every error class (`401/403/404/429/500`) passes cache/index/security-header assertions.                           |
| Injection/XSS     | All hostile content fixtures render without execution; no unreviewed raw-HTML escape hatch exists.                                                        |
| Redaction         | Canary scan across application logs, audit rows, browser responses, and error tracking reports finds zero secret values.                                  |
| Database boundary | Runtime DB role cannot mutate/delete audit rows; audit insertion failure demonstrably rolls back domain mutation.                                         |
| Deployment        | Staging checklist passes against the deployed Cloudflare/Railway boundary and evidence is attached to the release.                                        |
| Rollback          | Previous artifact rollback rehearsal passes without a schema rollback or privilege expansion.                                                             |
| Review            | Two-person review for auth/session/grant/migration code and Cloudflare/Railway policy; no unresolved P0/P1 security findings.                             |

No acceptance item may be waived silently. A temporary exception must name an
owner, expiration date, compensating control, and rollback/disable decision,
and must be approved before production deployment.
