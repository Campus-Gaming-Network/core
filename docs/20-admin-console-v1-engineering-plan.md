# 20 — Admin Console v1 engineering plan

**Status:** Active — moderation UI and catalog/access APIs complete
**Last updated:** 2026-09-22
**Audience:** Engineering, security, and operators
**Target:** `admin.campusgamingnetwork.com`

## Decision and outcome

Admin Console v1 is a **site-admin-only** control plane. School admins, event
organizers, team owners, and ordinary CGN users do not enter this application,
even when they hold elevated permissions on the public site.

The release is complete when an authorized site admin can, without raw SQL:

- triage reports and support tickets;
- manage schools, school-admin grants, and the curated games catalog;
- search users and manage the explicitly supported account and trust grants;
- grant or revoke site-admin access with recent-authentication protection;
- upload a validated school logo;
- inspect entity audit history; and
- have every privileged mutation authorized in Go and recorded transactionally.

The operations repository and schema are storage primitives, not an HTTP
authorization boundary. [`internal/adminhttp`](../apps/api/internal/adminhttp/)
exposes the approved site-admin routes through the capability boundary, while
[`internal/operations`](../apps/api/internal/operations/) and migration
[`000010_operations_foundation.up.sql`](../db/migrations/000010_operations_foundation.up.sql)
provide assignable report/support queues, retention clocks, `audit_logs`, and
notifications.

## Release principles

1. Treat the Admin Console as a separate privileged control plane, not as the
   public application with an admin navigation item.
2. Require two independent gates: Cloudflare Access at the edge and a current,
   revocable CGN site-admin grant in Go.
3. Never accept the public `cgn_session` as admin authorization. Use a separate
   opaque, server-side admin session.
4. Enforce capabilities on every `/admin/v1/*` endpoint in Go. The Admin BFF
   may improve UX, but it is not the authority.
5. Deny by default. Missing, expired, suspended, deleted, or revoked identities
   lose access immediately on the next request.
6. Couple privileged domain changes and their audit entries in one database
   transaction. If the audit insert fails, the mutation fails.
7. Render reports, support messages, notes, and other user-controlled values as
   plain text. Admin status does not make untrusted content safe.
8. Prefer a small, explicit first release over a general-purpose operations
   framework.

## Scope

### In v1

- Cloudflare Access application and phishing-resistant identity-provider MFA.
- A separate TanStack Start app in `apps/admin`, deployed independently.
- A separate admin-session cookie and session store.
- Site-admin grant bootstrap, grant, revoke, list, and recovery commands.
- Go capability middleware and `/admin/v1/*` handlers.
- Report and support-ticket queues: list, view, assign, change status, add a
  resolution note, and view audit history.
- Schools: search including inactive records, create, edit, deactivate,
  reactivate, soft-delete, and manage school-admin grants.
- School logos in Cloudflare R2: PNG or JPEG only, **5 MB maximum**. The 500 MB
  value in older planning documents is not the v1 implementation limit.
- Games: list, create, edit, activate/deactivate or soft-delete. The catalog
  remains curated by operators.
- Users: bounded search/detail, suspend/reactivate, and supported grant changes
  for `staff_faculty`, school admin, and site admin.
- Site-admin audit history and security-event logging.
- Desktop and mobile layouts sufficient for operational use, keyboard access,
  and accessible status/error feedback.

### Explicitly out of scope

- Access for school admins or any role other than `site_admin`.
- Impersonation.
- Feature flags and site-wide announcements.
- Arbitrary SQL, database browsers, shell access, or user-defined queries.
- Bulk mutations, bulk messaging, or unrestricted exports.
- IGDB synchronization or a broader games-import pipeline.
- User data export/deletion tooling; those need a separate privacy workflow.
- Editing passwords, primary emails, MFA methods, or recovery credentials.
- Rich HTML notes or messages.
- Custom event banners or other user uploads.
- A generic role editor. V1 supports named operations and known grants only.
- Approved-organizer grants, which do not yet have a persistence model.

## Threat model

The design assumes an attacker may possess a public CGN session, submit hostile
content to a report/support form, discover a Railway service hostname, or
compromise one operator credential. It does not assume Cloudflare Access, the
application, or an operator is infallible.

| Threat                                | V1 control                                                                                                                 | Required evidence                                                          |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Stolen public CGN session             | Public and admin cookies, stores, middleware, and proxy secrets are separate                                               | Public session receives `401` from every admin endpoint                    |
| Phished password or OTP               | IdP policy requires passkey/WebAuthn or a hardware security key                                                            | Access policy export and successful security-key login test                |
| Direct Railway-origin bypass          | Admin BFF validates the Access JWT on every request and fails closed when it is absent or invalid                          | Direct-origin request is denied before application content is rendered     |
| BFF-only authorization                | Go loads the admin session, active user, active site grant, and capability on every request                                | Handler tests bypass the BFF and still receive `401`/`403`                 |
| CSRF                                  | Host-only `SameSite=Strict` cookie, exact-origin checks, and a per-session CSRF token on every mutation                    | Cross-origin and missing-token browser tests fail                          |
| Stored/reflected XSS                  | Plain-text rendering, output escaping, no dangerous HTML sinks, and a strict CSP                                           | Payload fixtures cannot create executable markup                           |
| IDOR                                  | Go scopes each request by capability and loads the addressed entity server-side                                            | Cross-entity and random-ID tests return safe `404`/`403` responses         |
| Revoked admin keeps working           | Active grant lookup on every request and revocation of all admin sessions in the same transaction                          | An existing browser session fails immediately after revocation             |
| Suspended/deleted admin keeps working | Active user status is checked with the grant on every request                                                              | Suspension/deletion invalidates current sessions                           |
| Insider misuse                        | Required reasons for high-risk actions, transactional audits, security events, and no shared accounts                      | Audit entry identifies actor, session, action, entity, request, and reason |
| Audit tampering or gaps               | Append-only application interface; mutation and audit share a transaction; runtime DB role cannot update/delete audit rows | Forced audit failure rolls back the domain change                          |
| Concurrent overwrite                  | `updated_at` preconditions or version fields on mutable records                                                            | Stale updates return `409` without losing the newer change                 |
| Malicious or oversized logo           | Byte limit before decode, signature check, pixel limit, decode/re-encode, generated key, separate asset origin             | Polyglot, SVG, decompression-bomb, and oversize fixtures fail              |
| Sensitive data in logs/cache          | Safe structured logs, redaction, `private, no-store`, and no analytics/third-party scripts                                 | Automated header/log assertions pass                                       |
| Proxy-secret reuse                    | A distinct admin BFF secret authorizes only `/admin/v1/*`; public BFF secret is rejected                                   | Secret-crossing tests fail in both directions                              |

## Target architecture

```text
Operator browser
    │
    ▼
Cloudflare Access
  - explicit operator allowlist/group
  - passkey or hardware-key MFA at the IdP
  - short session for step-up path
    │
    ▼
admin.campusgamingnetwork.com
TanStack Start Admin BFF (`apps/admin`)
  - validates Cf-Access-Jwt-Assertion
  - exact-origin + CSRF enforcement
  - SSR, response-contract validation, no-store responses
    │  Railway private network
    │  distinct ADMIN_API_PROXY_SHARED_SECRET
    ▼
Go API `/admin/v1/*`
  - opaque admin session lookup
  - active account + active grant lookup
  - capability authorization
  - domain validation + transactions + audit
    ├────────► PostgreSQL
    └────────► Cloudflare R2 (school logos only)
```

The browser never calls the Go API directly. The Admin BFF forwards only the
admin-session cookie and required request metadata, not the browser's complete
cookie header. The API remains private on Railway networking. Cloudflare Access
still protects the public Admin BFF because a Railway-generated origin hostname
may otherwise bypass Cloudflare.

### Request flow

1. Cloudflare Access authenticates the operator and adds an Access assertion.
2. The Admin BFF verifies the JWT signature and validates issuer, audience,
   expiry, not-before, and required identity claims against configured values.
3. On exchange, the BFF sends the verified Access identity to the private Go
   endpoint using the admin-only proxy secret.
4. Go finds an active, email-verified CGN user whose normalized email matches
   the Access identity and confirms an active `site_admin` grant.
5. Go rotates an opaque admin token and the BFF mirrors the admin cookie to the
   browser.
6. Every subsequent request repeats Access validation at the BFF. Every API
   request independently reloads the admin session, account state, active grant,
   and required capability.
7. A mutation succeeds only when the domain write and audit insert commit
   together.

## Authentication and admin sessions

### Cloudflare Access boundary

- Create separate Access applications for production and staging.
- Limit membership to a named operator group or explicit identities. Access to
  CGN itself is not enough.
- Require phishing-resistant MFA through the identity provider. Email one-time
  codes are not sufficient as the only factor.
- Configure the Admin BFF with the exact team-domain issuer and application
  audience. Never accept an audience from the incoming request.
- Cache signing keys for a bounded period and refresh on an unknown key id; fail
  closed if keys cannot be refreshed after the cached key expires.
- Do not use identity headers unless they are derived from a locally validated
  Access JWT.
- Configure a path-specific, short-lived reauthentication policy for the step-up
  route. The implementation spike must prove that a newly issued Access
  assertion can be distinguished before enabling UI-based site-admin grants.
- Production and staging use different audiences and secrets.

### Separate opaque session

Use `__Host-cgn_admin_session` in production:

- `Secure`, `HttpOnly`, `SameSite=Strict`, `Path=/`;
- no `Domain` attribute;
- 30-minute idle timeout;
- 8-hour absolute timeout;
- random 256-bit token; only its cryptographic hash is persisted;
- rotation after exchange and step-up; and
- revocation on logout, site-admin grant revocation, account suspension/deletion,
  password recovery, or a security-relevant identity change.

The public `cgn_session` must be ignored by admin middleware. The API response
does not expose the Access assertion or session token in JSON. Session and auth
responses use `Cache-Control: private, no-store`.

### CSRF and recent authentication

- Generate a random CSRF token per admin session. Keep its hash with the server
  session and send the token through a `__Host-cgn_admin_csrf` strict, secure
  cookie plus a matching header or hidden form field.
- The Admin BFF compares both values in constant time and checks that `Origin`
  exactly equals `https://admin.campusgamingnetwork.com` for every mutation.
  Local development uses one explicitly configured local origin.
- `SameSite=Strict` is defense in depth, not the sole CSRF control.
- Granting/revoking site-admin access and suspending/reactivating a user require
  a step-up timestamp no older than 10 minutes and a non-empty reason.
- If the Cloudflare step-up route cannot guarantee a fresh phishing-resistant
  authentication, site-admin grant/revoke remains CLI-only for v1 rather than
  weakening this requirement.

## Authorization model

Persist only the `site_admin` role in v1, but authorize endpoints through named
capabilities so later roles cannot accidentally inherit the whole surface.

| Capability             | V1 use                                                         |
| ---------------------- | -------------------------------------------------------------- |
| `admin.session.read`   | Read the current admin identity/session                        |
| `reports.read`         | List/view reports                                              |
| `reports.manage`       | Assign and transition reports                                  |
| `support.read`         | List/view support tickets                                      |
| `support.manage`       | Assign and transition support tickets                          |
| `schools.read`         | Read active/inactive/deleted school administration data        |
| `schools.manage`       | Create/edit/deactivate/reactivate/soft-delete schools          |
| `school_logos.manage`  | Upload/remove validated school logos                           |
| `school_grants.manage` | Grant/revoke school-admin access                               |
| `games.manage`         | Manage the curated game catalog                                |
| `users.read`           | Bounded user search/detail for administrative work             |
| `users.manage_status`  | Suspend/reactivate accounts with step-up                       |
| `trust_grants.manage`  | Change supported non-site trust grants                         |
| `site_grants.manage`   | Grant/revoke site-admin access with step-up                    |
| `audit.read`           | Read entity audit history and allowed security-event summaries |

The role-to-capability map lives in reviewed Go code. It is not editable through
the database or Admin Console. Authorization middleware receives the required
capability from the route registration, resolves an actor once, and places only
that verified actor in request context. Domain services still enforce
resource/state rules.

An authorization result distinguishes:

- `401` for a missing, invalid, idle-expired, absolute-expired, or revoked admin
  session;
- `403` for an authenticated identity without the required active grant or
  capability; and
- `404` when returning existence would disclose an inaccessible resource.

## Data model and migrations

Use additive migrations first. Do not couple the initial deployment to dropping
or rewriting existing data.

### `site_role_grants`

```text
id                    uuid primary key
user_id               uuid -> users
role                  text check role = 'site_admin'
granted_by_user_id    uuid -> users, nullable only for bootstrap
grant_reason          text, required
granted_at            timestamptz
revoked_at            timestamptz nullable
revoked_by_user_id    uuid -> users nullable
revoke_reason         text nullable
```

- A partial unique index permits at most one active grant for a user and role.
- Grant/revoke operations lock the target grant rows.
- Revocation and all target user's active admin-session revocations occur in the
  same transaction and produce one audit entry.
- The last active site admin cannot be revoked through the UI or normal CLI.
  A documented break-glass command may override this only with an explicit flag,
  interactive confirmation, and a security event.

### `admin_sessions`

```text
id                    uuid primary key
user_id               uuid -> users on delete cascade
grant_id              uuid -> site_role_grants
token_hash            bytea unique
csrf_token_hash       bytea
authn_method          text check cloudflare_access
access_issuer         text
access_subject        text
access_email          citext
authenticated_at      timestamptz
step_up_at            timestamptz nullable
last_seen_at          timestamptz
idle_expires_at       timestamptz
absolute_expires_at   timestamptz
revoked_at            timestamptz nullable
revocation_reason     text nullable
created_at            timestamptz
```

- Index active sessions by user and expiry.
- Validate idle and absolute expiry in one lookup. Admin traffic is low enough
  for accurate `last_seen_at` updates; avoid the public-session write-throttling
  assumption here.
- Bind the session to the validated Access issuer/subject and current normalized
  email. A changed subject or mismatched current user email requires exchange.

### Audit and security events

Continue using `audit_logs` for domain history. Add queryable `admin_session_id`
and `request_id` fields if the implementation review confirms metadata-only
storage would make incident reconstruction unreliable. Every admin audit record
contains:

- actor user and admin session;
- stable action name and entity type/id;
- safe before/after values;
- request id;
- operator reason when required; and
- timestamp from the database.

Do not copy passwords, cookies, tokens, Access assertions, raw request bodies,
support contact information, or report/support free text into audit metadata.
The current queue audit stores resolution-note values in before/after JSON; the
admin API work must replace that with safe state plus a `resolution_note_changed`
indicator before treating the audit payload as a security boundary.

Add an append-oriented `admin_security_events` table or equivalent durable sink
for authentication exchange, logout, session revocation, step-up, denied
authorization, sensitive reads, and break-glass CLI use. Keep it separate from
domain audit history. Store bounded metadata and a privacy-reviewed network
identifier, not raw secrets. Runtime code exposes insert/list only. The
production runtime database role must not receive UPDATE or DELETE privileges on
audit/security-event tables; migrations and approved retention jobs use a
separate owner/maintenance role.

### Existing-model changes

- Extend school and game repositories with admin-safe commands rather than
  issuing SQL from HTTP handlers.
- Treat `school_admins.deleted_at` as revocation and restore the existing row on
  re-grant so its composite key is respected.
- Do not expose approved-organizer grants in v1 or infer them from UI state.
- Use `updated_at` as a mutation precondition initially. A stale version returns
  `409 conflict` with the current safe representation.
- Refresh/invalidate the existing school catalog cache after a committed school
  mutation. Do not wait for the 24-hour refresh interval.

## Bootstrap, revocation, and recovery

Add a non-networked command, for example `cgn-admin`, with explicit subcommands:

```text
cgn-admin grant-site-admin --email ... --reason ...
cgn-admin revoke-site-admin --email ... --reason ...
cgn-admin list-site-admins
cgn-admin revoke-sessions --email ... --reason ...
cgn-admin validate-access-config
```

Rules:

- Commands use the production database only through an operator-supplied
  environment and never accept a password or token on the command line.
- The first grant is allowed only when zero active site admins exist and records
  `bootstrap=true` plus the invoking operator identity in a security event.
- Later CLI grants require an active actor site admin unless an explicit
  break-glass mode is used.
- Granting requires an existing, active, email-verified CGN account whose email
  matches the intended Cloudflare Access identity.
- Revocation invalidates every active admin session transactionally.
- Normal revocation refuses to remove the final active site admin.
- Break-glass credentials and database access are documented outside the repo,
  held by the smallest practical operator set, and exercised in staging before
  production launch.
- Recovery consists of restoring Access membership, validating the CGN account,
  issuing a grant through the CLI, and revoking all questionable sessions. It
  does not involve editing rows by hand.

## HTTP API inventory

All routes use `/admin/v1`, require the admin proxy trust boundary, return
stable typed errors, and default to `private, no-store`. List endpoints use
bounded cursor pagination. Mutation bodies include the last-seen version where
applicable.

### Authentication

| Method | Path                      | Capability/control                   | Purpose                               |
| ------ | ------------------------- | ------------------------------------ | ------------------------------------- |
| POST   | `/admin/v1/auth/exchange` | Valid Access identity + active grant | Create/rotate admin session           |
| POST   | `/admin/v1/auth/step-up`  | Fresh Access assertion               | Rotate token and record recent auth   |
| GET    | `/admin/v1/session`       | `admin.session.read`                 | Current actor, capabilities, expiries |
| POST   | `/admin/v1/logout`        | Current session                      | Revoke and clear admin cookie         |

### Reports, support, and history

| Method | Path                            | Capability       | Purpose                             |
| ------ | ------------------------------- | ---------------- | ----------------------------------- |
| GET    | `/admin/v1/reports`             | `reports.read`   | Filtered, paginated queue           |
| GET    | `/admin/v1/reports/:id`         | `reports.read`   | Report detail and target summary    |
| PATCH  | `/admin/v1/reports/:id`         | `reports.manage` | Assign, transition, resolution note |
| GET    | `/admin/v1/support-tickets`     | `support.read`   | Filtered, paginated queue           |
| GET    | `/admin/v1/support-tickets/:id` | `support.read`   | Ticket detail                       |
| PATCH  | `/admin/v1/support-tickets/:id` | `support.manage` | Assign, transition, resolution note |
| GET    | `/admin/v1/audit`               | `audit.read`     | History for one allowed entity      |

### Schools and school grants

| Method | Path                                                  | Capability             | Purpose                               |
| ------ | ----------------------------------------------------- | ---------------------- | ------------------------------------- |
| GET    | `/admin/v1/schools`                                   | `schools.read`         | Search all states, including inactive |
| POST   | `/admin/v1/schools`                                   | `schools.manage`       | Create school; `unitid` optional      |
| GET    | `/admin/v1/schools/:id`                               | `schools.read`         | Admin detail and version              |
| PATCH  | `/admin/v1/schools/:id`                               | `schools.manage`       | Edit allowed fields                   |
| POST   | `/admin/v1/schools/:id/deactivate`                    | `schools.manage`       | Deactivate with reason                |
| POST   | `/admin/v1/schools/:id/reactivate`                    | `schools.manage`       | Reactivate with reason                |
| DELETE | `/admin/v1/schools/:id`                               | `schools.manage`       | Soft-delete with dependency checks    |
| POST   | `/admin/v1/schools/:id/logo`                          | `school_logos.manage`  | Validate, re-encode, and store logo   |
| DELETE | `/admin/v1/schools/:id/logo`                          | `school_logos.manage`  | Remove logo reference/object safely   |
| GET    | `/admin/v1/schools/:id/admin-grants`                  | `school_grants.manage` | Active and revoked grant history      |
| POST   | `/admin/v1/schools/:id/admin-grants`                  | `school_grants.manage` | Grant by user id with reason          |
| POST   | `/admin/v1/schools/:id/admin-grants/:grant_id/revoke` | `school_grants.manage` | Soft-revoke with reason               |

### Games, users, and site grants

| Method | Path                                     | Capability/control              | Purpose                              |
| ------ | ---------------------------------------- | ------------------------------- | ------------------------------------ |
| GET    | `/admin/v1/games`                        | `games.manage`                  | List active/deleted catalog entries  |
| POST   | `/admin/v1/games`                        | `games.manage`                  | Create curated entry                 |
| PATCH  | `/admin/v1/games/:id`                    | `games.manage`                  | Edit/version-check entry             |
| DELETE | `/admin/v1/games/:id`                    | `games.manage`                  | Soft-delete with dependency checks   |
| GET    | `/admin/v1/users`                        | `users.read`                    | Bounded exact/prefix search          |
| GET    | `/admin/v1/users/:id`                    | `users.read`                    | Safe account/grant summary           |
| POST   | `/admin/v1/users/:id/suspend`            | `users.manage_status` + step-up | Suspend with reason, revoke sessions |
| POST   | `/admin/v1/users/:id/reactivate`         | `users.manage_status` + step-up | Reactivate with reason               |
| PATCH  | `/admin/v1/users/:id/trust-grants`       | `trust_grants.manage`           | Supported named trust change         |
| GET    | `/admin/v1/site-admin-grants`            | `site_grants.manage`            | Active/revoked site-admin history    |
| POST   | `/admin/v1/site-admin-grants`            | `site_grants.manage` + step-up  | Grant with reason                    |
| POST   | `/admin/v1/site-admin-grants/:id/revoke` | `site_grants.manage` + step-up  | Revoke and end sessions              |

Do not implement a generic `CRUD /admin/users` endpoint. Each high-risk state
transition is a named operation with its own validation, authorization, audit,
and test cases.

## Admin application work

Create `apps/admin` by following the existing TanStack Start conventions in
[`apps/web`](../apps/web/) while keeping code, cookies, server-only modules, and
deployment configuration separate.

Required route groups:

- `/` operational overview with queue counts and no sensitive details;
- `/reports`, `/reports/$id`;
- `/support`, `/support/$id`;
- `/schools`, `/schools/new`, `/schools/$id`;
- `/games`, `/games/$id`;
- `/users`, `/users/$id`;
- `/access/site-admins`; and
- entity-local audit-history panels.

Implementation rules:

- SSR every authorization-sensitive route. Do not flash protected content while
  a client-side permission check runs.
- Put API operations in feature-local `*.server.ts` modules. Client components
  may receive validated DTOs but cannot import secrets or server code.
- Validate every Go success payload and mutation input at the BFF boundary with
  Zod. Go remains authoritative.
- Use native forms plus progressive enhancement for mutations. Include CSRF and
  stale-version fields in both paths.
- Require an explicit confirmation and reason for destructive/high-risk actions.
- Show the acting admin, environment, and session expiry persistently. Staging
  must be visually unmistakable from production.
- Treat report reasons, support messages, names, subjects, and notes as plain
  text. Do not add Markdown or HTML rendering in v1.
- Set `X-Robots-Tag: noindex, nofollow, noarchive`, route metadata `noindex`, a
  restrictive CSP, `Referrer-Policy: no-referrer`, and
  `Cache-Control: private, no-store`.
- No analytics, tag managers, support widgets, remote fonts, or third-party
  scripts.
- Provide keyboard-complete tables/forms, visible focus, labeled statuses, live
  error summaries, and mobile layouts for on-call use.

Adding `apps/admin` also requires:

- `apps/admin/Dockerfile`;
- an `admin` service in [`docker-compose.yml`](../docker-compose.yml), preferably
  behind an `admin` profile so the core stack does not start it by default;
- adding the workspace and `dev/build/lint/typecheck/test` scripts at the root;
  and
- `npm run check:apps-compose` in CI and acceptance checks.

## School-logo upload design

V1 accepts only PNG and JPEG school logos with a **5 MB encoded-file limit**.
The older 500 MB planning value must not become a constant or infrastructure
limit.

Processing order:

1. Enforce request/body size before buffering or decoding.
2. Verify magic bytes and successfully decode as PNG or JPEG; ignore the
   client-supplied MIME type and filename.
3. Reject SVG, animated images, multiple-image containers, malformed files,
   dimensions over 4096×4096, or more than 16 million decoded pixels.
4. Normalize orientation, strip metadata, and re-encode server-side to a known
   PNG or JPEG profile.
5. Generate the R2 key server-side using a random/object-version component.
6. Upload to a temporary key, commit the school logo reference and audit entry,
   then promote/retain the new object and clean up the old object best-effort.
7. Serve it from a separate asset hostname with an immutable content type and
   without active-content sniffing.

R2 credentials stay in the Go API. The browser does not receive broad R2
credentials. If direct presigned upload is introduced later, a finalize endpoint
must still verify and re-encode the object before it becomes public.

## Deployment and configuration

### Services

- `apps/admin`: public Railway service reached through Cloudflare Access.
- `apps/api`: existing private Railway service with admin routes dark until
  enabled.
- PostgreSQL: existing database with additive migrations and verified backup.
- R2: dedicated school-logo bucket/prefix and narrowly scoped service token.

### Configuration contract

Names may be refined during implementation, but production must fail closed
when any required value is absent or unsafe:

```text
ADMIN_ENABLED
ADMIN_SITE_URL
ADMIN_API_INTERNAL_URL
ADMIN_API_PROXY_SHARED_SECRET
ADMIN_SESSION_COOKIE
ADMIN_SESSION_IDLE_TTL
ADMIN_SESSION_ABSOLUTE_TTL
CLOUDFLARE_ACCESS_TEAM_DOMAIN
CLOUDFLARE_ACCESS_AUDIENCE
CLOUDFLARE_ACCESS_JWKS_URL
R2_ACCOUNT_ID
R2_SCHOOL_LOGOS_BUCKET
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_PUBLIC_ASSET_ORIGIN
```

- The admin and public BFF proxy secrets are different, randomly generated, and
  rotated independently.
- Staging and production have different Access audiences, database credentials,
  R2 prefixes/buckets, and secrets.
- `ADMIN_ENABLED=false` disables exchange and all non-health admin routes as a
  kill switch.
- Strict environments require HTTPS origins, the `__Host-` cookie name, secure
  cookies, non-default secrets, bounded TTLs, and an Access audience.
- Request logs include a generated request id but never cookies, authorization
  assertions, proxy secrets, request bodies, contact emails, or notes.

### Observability

Emit safe counters and structured events for:

- Access assertion failures by reason category;
- admin exchange, logout, expiry, step-up, and revocation;
- `401`, `403`, CSRF failures, and rate-limit responses;
- privileged mutations by stable action name and outcome;
- audit-write rollback;
- R2 validation/upload/cleanup failures; and
- unusual denied-request or session-creation rates.

Alert on repeated Access-validation failures, repeated denied authorization,
any audit-write failure, and elevated admin 5xx rates. Do not treat audit rows as
application error logs.

## Test and verification matrix

### Actor matrix

Every route family must cover:

| Actor/state                                   | Expected result                              |
| --------------------------------------------- | -------------------------------------------- |
| No Access assertion                           | BFF denies; no protected HTML or API call    |
| Invalid/wrong-audience Access assertion       | BFF denies closed                            |
| Valid Access identity, no admin session       | Exchange path only; otherwise `401`          |
| Public CGN session only                       | `401`                                        |
| Ordinary user                                 | Exchange/route denied                        |
| Active school admin without site grant        | `403`; school scope grants no console access |
| Revoked site admin with existing session      | Immediate `403`/`401`; session revoked       |
| Suspended/deleted site admin                  | Denied and sessions revoked                  |
| Idle-expired admin session                    | `401` and cookie cleared                     |
| Absolute-expired admin session                | `401` and cookie cleared                     |
| Active site admin                             | Only named capabilities succeed              |
| Active site admin lacking a future capability | `403` despite console access                 |

### Security and contract tests

- Access JWT signature, issuer, audience, expiry, not-before, key rotation, and
  fail-closed key-fetch behavior.
- Admin/public cookie and proxy-secret non-interchangeability.
- CSRF: absent token, mismatched token, foreign/missing Origin, stale token after
  rotation, native form, and enhanced request.
- Session fixation, token rotation, idle/absolute expiry, logout, grant
  revocation, password recovery, and concurrent session revocation.
- Capability table tests covering every route registration.
- IDOR/random UUID and soft-deleted entity behavior.
- Typed error/status/code contracts and absence of raw upstream messages.
- Transaction rollback when audit insert fails for every mutation family.
- Stale version conflicts and concurrent queue assignment.
- Audit redaction: no token, cookie, Access JWT, proxy secret, password, contact
  email, or free-text body in audit/security logs.
- Stored-XSS fixtures in every displayed user-controlled field and CSP browser
  assertions.
- Logo size, signature, malformed input, SVG/polyglot, pixel bomb, metadata
  stripping, R2 failure, database failure, and orphan cleanup.
- Response headers: no-store, noindex, CSP, no-referrer, MIME protections.
- Pagination bounds, search limits, and enumeration/rate-limit behavior.

### End-to-end journeys

Run against a real Go API and PostgreSQL, not only the fake browser API:

1. Access-authenticated site admin exchanges a session, triages a report, and
   sees its audit history.
2. Site admin assigns and resolves a support ticket containing hostile markup;
   it remains inert text.
3. Site admin creates/edits/deactivates/reactivates a school; the public catalog
   reflects the committed state after cache refresh.
4. Site admin grants and revokes a school admin; public role indicators follow
   the active grant.
5. Site admin uploads and removes a valid logo; invalid and oversized files fail.
6. Site admin updates a game and a stale second browser receives `409`.
7. Site admin steps up, grants another site admin, then revokes that grant; the
   second admin's open session stops working immediately.
8. Direct Railway origin, public cookie, revoked grant, and cross-origin form
   attempts all fail without leaking protected content.

Required checks include Go unit/database/handler tests, admin typecheck/lint/unit
tests, Playwright desktop/mobile/no-JavaScript coverage, production builds,
Compose parity, migration verification, and a staging security smoke test.

## Phased ticket plan

Ticket ids below are scoped to this plan and can be copied into the canonical
tracker when implementation begins.

### AC-001 — Freeze security contracts and threat cases

**Status:** Complete (2026-09-15)
**Depends on:** none
**Deliverables:** Route/capability registry, stable error codes, Access claim
contract, session/CSRF contract, audit action names, sensitive-field inventory,
and abuse-case test fixtures.

**Acceptance criteria:**

- Every proposed endpoint has one required capability and data classification.
- The public session and public BFF secret are explicitly excluded.
- High-risk operations and their reason/step-up requirements are enumerated.
- Deferred features cannot be reached through a generic endpoint.

### AC-002 — Add admin grants, sessions, and security-event migrations

**Status:** In progress
**Depends on:** AC-001
**Deliverables:** Additive migrations for `site_role_grants`, `admin_sessions`,
security events, indexes, and any approved audit linkage; repository tests.

**Acceptance criteria:**

- One active site grant per user/role is database-enforced.
- Hashed tokens and CSRF values are the only persisted token material.
- Expired/revoked-session queries use bounded indexes.
- Runtime database permissions prevent audit/security-event mutation.
- Migration applies to a copy of current schema and existing tests pass.

Implemented so far: additive `site_role_grants` and `admin_sessions`
migrations, the deny-by-default [`adminaccess`](../apps/api/internal/adminaccess/)
capability/grant package, the isolated
[`adminsession`](../apps/api/internal/adminsession/) package, hashed session and
CSRF credentials, exact-grant binding, transactional grant auditing, explicit
bootstrap provenance, last-admin protection, and transactional session closure
on grant revocation. Migration `000014_admin_security_events.up.sql` and the
closed-metadata [`adminsecurity`](../apps/api/internal/adminsecurity/) package
now provide durable append-oriented authentication, authorization, session,
sensitive-read, and break-glass events plus audit request/session correlation.
Enabled staging/production startup also fails when the API role owns or can
update, delete, or truncate audit/security-event tables, or lacks the required
select/insert access. Provisioning the distinct production role and exercising
that check in staging remain before AC-002 is complete.

### AC-003 — Implement bootstrap, revoke, and recovery CLI

**Status:** In progress
**Depends on:** AC-002
**Deliverables:** `cgn-admin` command, validation, safe output, audit/security
events, staging runbook.

**Acceptance criteria:**

- First-admin bootstrap works only at zero active grants.
- Normal flows cannot revoke the final active site admin.
- Revocation closes all target admin sessions transactionally.
- Commands never print credentials or accept secrets in argv.
- Staging recovery drill succeeds without manual SQL.

Implemented so far: the non-networked `cgn-admin` binary supports explicit
first-admin bootstrap, normal grant/revoke, active-admin listing, bulk session
revocation, and enabled Access-configuration validation. It requires an
operator-supplied database environment, keeps credentials out of arguments,
uses the shared last-admin and eligibility invariants, and writes bootstrap or
session-revocation security events transactionally. The operator procedure is
documented in
[`22-admin-console-access-runbook.md`](./22-admin-console-access-runbook.md).
A successful staging recovery drill remains before AC-003 is complete.

### AC-004 — Establish Cloudflare Access and Admin BFF trust

**Status:** In progress
**Depends on:** AC-001
**Deliverables:** Access applications/policies, JWT validator, direct-origin
denial, staging configuration, step-up feasibility spike.

**Acceptance criteria:**

- Wrong/missing issuer, audience, signature, or time claims fail closed.
- Railway-origin access cannot render protected Admin Console content.
- Staging requires a passkey/security key through the configured IdP.
- Fresh step-up can be proven; otherwise site-grant UI is marked CLI-only.

Implemented so far: strict enabled/disabled configuration validation, distinct
admin proxy-secret enforcement, direct-origin route concealment, and an RS256
Cloudflare Access assertion validator with exact issuer/audience/time checks,
bounded JWKS retrieval, caching, and signing-key rotation. Cloudflare policy
provisioning and a staging step-up proof remain.

### AC-005 — Implement Go admin sessions and CSRF boundary

**Status:** Complete
**Depends on:** AC-002, AC-003, AC-004
**Deliverables:** Exchange, step-up, session, logout endpoints; admin cookie;
session repository; BFF cookie mirroring; CSRF verification.

**Acceptance criteria:**

- Public cookies and proxy secrets cannot authenticate admin routes.
- Idle, absolute, logout, account-state, and grant revocation paths work.
- Tokens rotate after exchange and successful step-up.
- Every mutation fails without exact origin and a valid session CSRF token.
- Session responses are private/no-store and reveal no token material.

Implemented: `/admin/v1/auth/exchange`, `/admin/v1/auth/step-up`,
`/admin/v1/session`, and `/admin/v1/logout`; isolated host-only cookies;
exact-origin and double-submit CSRF enforcement; atomic session-token rotation;
and private/no-store responses. Step-up requires a newer Access assertion for
the same issuer, subject, and email, issued within the 10-minute recent-auth
window. Exchange, successful step-up, and logout now commit their session
mutation and security event in one PostgreSQL transaction. The Admin BFF
validates the fresh assertion independently, forwards only the isolated admin
cookies, and mirrors both rotated cookies atomically.

### AC-006 — Add capability authorization and route registration

**Status:** Complete
**Depends on:** AC-005
**Deliverables:** Go role-to-capability map, authorization middleware, actor
context, default-deny admin router, test matrix.

**Acceptance criteria:**

- Every `/admin/v1/*` route declares a capability or auth-specific control.
- Ordinary, school-admin-only, revoked, and suspended users are denied.
- The active grant and user state are checked on every request.
- A registration test fails when a new route lacks an authorization policy.

Implemented: the Admin API uses an explicit, unique route-policy registry and
default-denies unknown routes. One authorization middleware resolves a verified
actor from the isolated session plus a fresh active-grant lookup, verifies exact
user/grant/role binding and the declared capability, enforces recent
authentication where registered, and places only that actor in request context.
Mutation registration automatically requires the exact configured origin and
the session-bound CSRF token before handler work. Registry validation rejects
duplicates, unsupported capabilities, uncontrolled routes, and unsafe methods
without a mutation policy; the actor matrix covers missing, revoked,
school-admin-only, stale-grant, and allowed cases.

### AC-007 — Harden transactional audit and security logging

**Status:** Complete (2026-09-17)
**Depends on:** AC-002, AC-006
**Deliverables:** Shared audit writer, request/session correlation, safe
before/after schemas, security-event writer, redaction tests.

**Acceptance criteria:**

- Domain and audit writes share one transaction for every mutation.
- Forced audit failure rolls back the domain write.
- Queue audits no longer duplicate resolution-note text.
- Sensitive-field scanning finds no prohibited data in audit/log fixtures.
- Audit/security records are not editable through application repositories.

Implemented with a shared append-only audit store and closed schemas for queue
and site-role-grant history. Queue mutations require actor, admin-session, and
request correlation, store only safe state plus a
`resolution_note_changed` marker, and commit their domain and audit writes in
one transaction. Site-role grants use the same transactional writer, bootstrap
uses the typed security-event store, and forced foreign-key failures verify
that report and grant domain writes roll back. Runtime privilege checks and
insert/list-only repository surfaces keep audit and security records immutable
to application code.

### AC-008 — Expose reports, support, and audit history

**Status:** Complete (2026-09-18)
**Depends on:** AC-006, AC-007
**Deliverables:** Paginated API handlers/services and database coverage for queue
list/detail/patch and scoped audit history.

**Acceptance criteria:**

- Status/assignee filters and cursor pagination are bounded and deterministic.
- Stale/concurrent patches return `409` rather than overwrite.
- User-controlled text is transported as data, not markup.
- Every mutation has a safe transactional audit and actor/session/request id.
- Full actor and IDOR tests pass.

Implemented: capability-gated report and support list/detail/patch routes plus
entity-scoped audit history. Queue and audit lists use bounded keyset cursors
with deterministic ordering and status/assignee filters. Patch requests carry
an `updated_at` precondition, serialize through row locks, and return `409` for
stale writes. Handler and PostgreSQL coverage verifies authenticated audit
correlation, transactional rollback, hostile text as escaped JSON data, safe
unknown-resource responses, reverse pagination, and concurrent updates.

### AC-009 — Add schools, games, users, and grant services

**Status:** Complete (2026-09-22)
**Depends on:** AC-006, AC-007
**Deliverables:** Named Go commands/queries and handlers for the in-scope catalog,
account-status, trust, school-admin, and site-admin operations.

**Acceptance criteria:**

- Handlers contain no direct SQL and accept only named fields/transitions.
- School mutations refresh the public catalog after commit.
- Dependency checks prevent unsafe school/game deletion.
- Site grant changes and account suspension require step-up and reason.
- Revocation closes sessions in the same transaction.
- Version conflicts and the last-site-admin invariant are tested.

Implemented: capability-gated, bounded school/game/user and grant queries;
named catalog lifecycle, school-admin, staff/faculty, account-status, and
site-admin commands; and scoped audit routes. Each command commits its safe
audit entry with the domain write. Suspensions and school/trust revocations
also revoke public and admin sessions transactionally. Site-grant revocation
ends all of the target user's admin sessions. Suspending or revoking an admin
counts only active, verified, nondeleted administrators; public account deletion
uses the same last-administrator lock and invariant.

Migration `000015_admin_catalog_commands.up.sql` adds game activation, a stable
school-grant ID without replacing its composite key, pagination/search indexes,
monotonic mutation timestamps, and database reference guards. Deletion refuses
schools with user/event/team history or active follows/grants, and games with
event/team references. Reference insertion and deletion coordinate through row
locks, including inserts that started before a soft delete. School mutations
invalidate and refresh the serving API process's catalog after commit; a failed
refresh falls back to database reads. Inactive games leave the public picker
while existing event/team associations remain readable, and editing an event
keeps its inactive games.

API contracts for AC-013:

- Lists accept `limit` (1–100), `after` or `before`, and applicable `state`
  filters. Catalog and user searches accept a literal, case-insensitive `q`
  prefix; wildcard characters do not expand the search. School/game states are
  `active`, `inactive`, and `deleted`; user states are `active`, `suspended`, and
  `deleted`; grant states are `active` and `revoked`.
- Catalog create/edit bodies contain the complete typed editable form plus
  `reason`. School fields exclude logo and lifecycle state; game fields include
  `is_active`. Mutations of existing records require `expected_updated_at`.
  Stale school/game/account writes return `409 admin_record_conflict` with
  `current`; clients reload grant detail/history after grant conflicts.
- A first school grant accepts `user_id` and `reason` without a version.
  Re-grant restores the existing row and requires its last `updated_at` value.
  Revocation uses the stable grant ID scoped to its school. Every transition
  remains available in the grant's append-only audit history.
- Site-grant creation uses the target user's `updated_at` precondition. Grant
  and revoke advance that user version, so an old grant form cannot silently
  restore revoked access. Site-grant revocation uses `granted_at` as the
  `expected_updated_at` value and checks the exact grant ID. Both site-grant
  mutations and account-status changes require recent step-up and a reason.
- Trust changes accept only the named `staff_faculty` boolean. Removing that
  grant restores the account's email-derived baseline verification level.
- Entity audit routes are `/schools/:id/audit`, `/games/:id/audit`,
  `/users/:id/audit`, `/site-admin-grants/:id/audit`, and
  `/schools/:id/admin-grants/:grant_id/audit`, all under `/admin/v1`.

Validation includes PostgreSQL-backed HTTP journeys, the actor/CSRF/step-up
matrix, audit-failure rollback, stale/concurrent writes, literal search and
bidirectional pagination, grant reactivation history, session revocation,
last-admin concurrency, and concurrent catalog-reference/deletion protection.
The full Go suite and `go vet` pass in Docker. Production enablement and the
external Access step-up policy proof remain part of AC-014/AC-015.

### AC-010 — Implement the 5 MB R2 school-logo pipeline

**Depends on:** AC-009
**Deliverables:** R2 client, server-side validation/re-encoding, object lifecycle,
admin endpoints, failure cleanup, image-security fixtures.

**Acceptance criteria:**

- A 5 MB request limit is enforced before decode.
- Only decoded/re-encoded PNG/JPEG output becomes public.
- Dimension/pixel limits, SVG/polyglot, malformed, and metadata tests pass.
- Database/audit failure cannot publish an unreferenced final object.
- R2 credentials never reach the browser.

### AC-011 — Scaffold and secure `apps/admin`

**Status:** Complete (2026-09-16)
**Depends on:** AC-004, AC-005, AC-006
**Deliverables:** TanStack Start app, root/session layout, server-only API client,
validated contracts, Dockerfile, optional Compose service, root scripts, security
headers, error boundaries.

**Acceptance criteria:**

- App starts locally through its Compose profile and passes
  `check:apps-compose`.
- Protected routes authorize during SSR without a content flash.
- All responses carry the required cache/index/security headers.
- No public-web cookie or server module is reused implicitly.
- Typecheck, lint, unit, build, accessibility smoke, and no-JS shell pass.

### AC-012 — Build moderation and audit UI

**Status:** Complete (2026-09-18)
**Depends on:** AC-008, AC-011
**Deliverables:** Report/support queues, details, filters, assignment/status/note
forms, audit panels, accessible feedback.

**Acceptance criteria:**

- Both enhanced and native-form flows complete the same operations.
- Hostile stored content remains inert under the production CSP.
- Stale conflicts preserve the operator's input and show the current state.
- Desktop, mobile, keyboard, and screen-reader smoke journeys pass.

Implemented: capability-aware report and support navigation, bounded queue
filters and pagination, scoped detail views, assignment/status/resolution forms,
and safe append-only audit timelines. A server-only BFF contract validates and
strips every response, forwards only isolated Admin cookies, and attaches the
server-read Origin and CSRF value to mutations. Enhanced stale-write handling
keeps operator input, displays the newly loaded state, advances the version
precondition, and permits a reviewed retry. Native forms execute the same
validated PATCH operation and redirect to accessible status feedback. The
production-browser suite covers hostile stored markup, keyboard navigation,
desktop/mobile axe scans, conflict recovery, and a no-JavaScript mutation with
rendered audit history.

### AC-013 — Build catalog, user, and access UI

**Depends on:** AC-009, AC-010, AC-011
**Deliverables:** School/game/user/access screens, confirmation/reason flows,
step-up redirect/return, logo upload, session-revocation feedback.

**Acceptance criteria:**

- No generic record editor or hidden deferred action ships.
- Destructive/high-risk actions require confirmation and the defined reason.
- Site-grant actions require verified recent authentication or remain CLI-only.
- Valid logo workflow and all rejected-file states are accessible.
- Revoked admin sessions stop navigating/mutating immediately.

### AC-014 — Production hardening and independent security review

**Depends on:** AC-003 through AC-013
**Deliverables:** Real-stack E2E suite, configuration validation, rate limits,
alerts/dashboard, dependency and secret review, operator runbooks, staging
penetration pass.

**Acceptance criteria:**

- Full actor/security matrix and eight real-stack journeys pass.
- Direct-origin, CSRF, XSS, IDOR, stale-write, upload, and revocation tests pass.
- Production config fails closed on every missing/unsafe security value.
- Backup/restore, grant recovery, session revocation, and kill-switch drills pass.
- No unresolved critical/high security findings remain; medium findings have an
  owner and documented release decision.

### AC-015 — Deploy and roll out Admin Console v1

**Depends on:** AC-014
**Deliverables:** Production migrations, Access policy, Railway/R2 services,
bootstrap grant, smoke test, limited operator rollout, launch record.

**Acceptance criteria:**

- A database backup is verified before migration.
- `ADMIN_ENABLED` stays false until migrations, API, Access, and Admin BFF are
  healthy.
- The first operator completes the production smoke test with no raw SQL.
- Logs/audits contain request correlation and no prohibited sensitive data.
- Rollback and emergency revocation are available during the rollout window.

## Sequencing and release gates

```text
AC-001
 ├─ AC-002 ─ AC-003 ─┐
 └─ AC-004 ──────────┼─ AC-005 ─ AC-006 ─ AC-007
                     │                ├─ AC-008 ─ AC-012
                     │                └─ AC-009 ─ AC-010 ─ AC-013
                     └──────────────────── AC-011 ────────┘
                                                        │
                                                     AC-014
                                                        │
                                                     AC-015
```

The first hard gate is AC-006: no operations endpoint or protected UI is exposed
before separate sessions and Go authorization exist. The second hard gate is
AC-014: production stays disabled until the real-stack security matrix passes.

## Rollout

1. Merge additive migrations and deploy the API with `ADMIN_ENABLED=false`.
2. Verify backup/restore and run repository/migration tests in staging.
3. Configure staging Access and complete the recovery and direct-origin drills.
4. Deploy `apps/admin` to staging; run the complete real-stack and security suite.
5. Configure production Access and R2 without adding operators yet.
6. Apply production migrations, deploy API/Admin BFF dark, and verify health.
7. Bootstrap the first site admin through the CLI and a second recovery admin
   through the normal grant path.
8. Enable production for those named operators only and run the smoke journeys.
9. Watch authentication failures, authorization denials, audit failures, admin
   5xx, and R2 errors through a limited rollout window.
10. Add further site admins only after the first operational review.

## Rollback and emergency response

- Set `ADMIN_ENABLED=false` to disable exchange and privileged routes.
- Remove/deny the Cloudflare Access policy and, if necessary, route DNS to a
  static denial response.
- Revoke all admin sessions with the CLI; revoke individual site grants for a
  suspected operator compromise.
- Roll the Admin BFF/API image back independently. Additive schema remains in
  place; do not drop grant, session, audit, or security-event records during an
  application rollback.
- Rotate the admin proxy secret, Access audience/application credentials, and R2
  token if their confidentiality is in question.
- Preserve audit/security records and request-correlated system logs for
  incident review. Do not use application rollback as a log-deletion mechanism.
- Restore school/game data from before/after audit state only through a reviewed
  corrective command, never by reversing arbitrary audit JSON automatically.

## Explicit v1 decisions

| Topic                | Decision                                                                      |
| -------------------- | ----------------------------------------------------------------------------- |
| Audience             | Site admins only; school admins have no console access                        |
| Edge gate            | Cloudflare Access with phishing-resistant IdP MFA                             |
| App identity         | Existing active, email-verified CGN user matched to validated Access identity |
| Browser auth         | Separate opaque admin session; public session is never sufficient             |
| Authorization        | Go capability checks on every request; default deny                           |
| Role model           | One persisted v1 role (`site_admin`), capability map in Go                    |
| API shape            | Named `/admin/v1/*` operations, not generic CRUD                              |
| BFF trust            | Distinct admin-only proxy secret over Railway private networking              |
| Session lifetime     | 30-minute idle, 8-hour absolute                                               |
| CSRF                 | Exact origin plus per-session token; `SameSite=Strict` is supplemental        |
| Critical actions     | Recent auth within 10 minutes plus reason                                     |
| Auditing             | Domain mutation and safe audit entry in one transaction                       |
| Sensitive reads      | Separate security event, no free-text/body duplication                        |
| Uploads              | School logos only; PNG/JPEG; 5 MB; decode/re-encode; separate asset origin    |
| Cache/search refresh | Invalidate/refresh school catalog after commit                                |
| Deployment           | Separate `apps/admin` Railway service and release                             |
| Kill switch          | `ADMIN_ENABLED` disables privileged surface                                   |
| Deferred             | Impersonation, feature flags, announcements, bulk tools, exports, IGDB        |

## Related repository references

- [Architecture](./06-architecture.md)
- [Permissions](./07-permissions.md)
- [API inventory](./04-api.md)
- [Roadmap](./05-roadmap.md)
- [Delivery status](./10-delivery-status.md)
- [Legal and data-lifecycle plan](./16-legal-and-data-lifecycle-plan.md)
- [Operations foundation repository](../apps/api/internal/operations/operations.go)
- [Operations foundation migration](../db/migrations/000010_operations_foundation.up.sql)
- [Current API router](../apps/api/internal/httpapi/router.go)
- [Current production deployment plan](./13-deployment-plan.md)
