# 27 — Backend onboarding

A guide for a developer joining the Go API (`apps/api`) and the database
(`db/migrations`). It explains how the pieces fit and where to start. It does
not own any rule: where a fact has an owner (see
[README — Sources of truth](./README.md#sources-of-truth)), this page links to
it rather than restating it.

Read [`CLAUDE.md`](../CLAUDE.md), [`AGENTS.md`](../AGENTS.md), and
[Go style](./go-style.md) first. The frontend half of the system is in
[26 — Frontend onboarding](./26-frontend-onboarding.md); the boundary between
the two is described there and in [04 — API](./04-api.md#pattern-backend-for-frontend-bff).

## The short version

- The Go API is the only thing that touches Postgres. Every rule lives here:
  authentication, authorization, validation, rate limits, content policy,
  transactions, and side effects such as notifications and email.
- Its only clients are the two TanStack Start servers (the web BFF and the
  Admin Console BFF), over a private network. No browser calls it directly.
- It uses the standard library `net/http` mux and `pgx` with hand-written SQL.
  There is no web framework and no ORM.
- Code is organized by domain package under `internal/`. HTTP handlers live in
  `internal/httpapi` (public) and `internal/adminhttp` (Admin API).
- Errors cross package boundaries as `apperror` values with a stable code. One
  function maps them to HTTP statuses.

## Where things live

```text
apps/api/
  cmd/
    api/        the HTTP server and its background workers
    migrate/    applies db/migrations
    seed/       school catalog import, dev user, optional demo data
    cgn-admin/  operator CLI for Admin Console bootstrap and recovery
    e2e-seed/   fixtures for the browser suites
  internal/
    httpapi/    public HTTP edge: router, handlers, middleware, error mapping
    adminhttp/  Admin API edge (/admin/v1): route policy table, handlers
    <domain>/   teams, events, clubs, schools, users, games, people, safety, ...
    auth/       sessions, passwords, tokens, account service
    apperror/   classified errors with stable codes
    emailoutbox/  durable email queue and its worker
    notifications/  in-app notices
    ratelimit/  in-process limiters
    redact/     log handler that strips personal data and secrets
    config/     environment configuration
    db/, migrate/, dbtest/  pool setup, migration runner, test helpers
db/migrations/  NNNNNN_name.up.sql, forward-only
```

A domain package holds the domain's types, a consumer-facing `Repository`
interface, a `PostgresRepository` that implements it, input validation, and the
domain's sentinel errors. `internal/teams/teams.go` is a good reference: one
file, about 1,300 lines, covering create, join, roles, and leave.

## How a request flows

```mermaid
sequenceDiagram
    participant BFF as Web BFF
    participant MW as Middleware<br/>httpapi/router.go
    participant H as Handler<br/>httpapi/team_handlers.go
    participant Repo as Repository<br/>teams/teams.go
    participant PG as Postgres

    BFF->>MW: POST /teams/varsity/join (session cookie, visitor headers)
    MW->>MW: log, security headers, panic recovery, body limit
    MW->>MW: auth.WithSession: cookie → user in context
    MW->>H: handleJoinTeam(slug)
    H->>H: auth.RequireUser → 401 if anonymous
    H->>H: allowAccount("team-join:"+slug) → 429 if over limit
    H->>H: decodeJSON → 400 if malformed
    H->>Repo: PasswordHash, then Join(ctx, slug, userID)
    Repo->>PG: BEGIN; lock team; upsert member; insert notice; enqueue email; COMMIT
    Repo-->>H: Team or apperror (team_not_found, ...)
    H-->>BFF: 200 JSON, or { "error": "<code>" } via writeApplicationError
```

### Middleware

`NewRouter` in `internal/httpapi/router.go` builds every dependency and wraps
the mux, outermost first:

1. `withRequestLogging` — one structured line per request.
2. `withSecurityHeaders` — `Cache-Control: no-store` and a deny-all CSP by
   default ([06 — Response security headers](./06-architecture.md#response-security-headers)).
3. `withPanicRecovery` — a panic becomes a 500, not a dropped connection.
4. `withBodyLimit` — oversized bodies get `413 request_too_large`.
5. For every path except `/admin/`: `auth.WithSession` reads the session cookie
   and puts the user id in the request context, then `activity.Middleware`
   records the day the account was active. `/admin/` paths skip both and go to
   `adminhttp`, which has its own session.

### Handlers

Public handlers are methods on `*Router` and follow one shape. From
`handleJoinTeam`:

```go
if r.teams == nil {
    writeError(w, http.StatusServiceUnavailable, "database_unavailable")
    return
}
userID, err := auth.RequireUser(req.Context())
if err != nil {
    writeError(w, http.StatusUnauthorized, "authentication_required")
    return
}
if !r.allowAccount("team-join:"+slug, userID) {
    rateLimitExceeded(w, r)
    return
}
var request joinTeamRequest
if !decodeJSON(w, req, &request) {
    return
}
team, err := r.teams.Join(req.Context(), slug, userID)
if err != nil {
    writeApplicationError(w, err, "team_join_failed")
    return
}
writeJSON(w, http.StatusOK, team)
```

- Early returns for every failure, each writing a stable error code.
- `allowVisitor` limits anonymous actions by client and target; `allowAccount`
  limits signed-in actions by user. The client key comes from the BFF's
  visitor headers only when they carry the shared proxy secret
  (`httpapi/visitor_identity.go`); otherwise it is the peer address.
- The fallback code passed to `writeApplicationError` names the operation
  (`team_join_failed`) and is what the client sees for an unclassified error.
  Only 500s are reported to Sentry.

There are two routing styles. Older areas (teams, schools) register a prefix
such as `/teams/` and split the path in the handler (`pathParts`). Newer areas
(events, clubs) register Go 1.22 patterns, `/events/{slug}/rsvp`, through an
adapter (`eventRoute`) that checks the method, decodes the slug, and answers
`405` with an `Allow` header. Use the pattern style for new routes.

### Repositories

The repository does the work the handler cannot: everything that needs the
database to be consistent. `teams.PostgresRepository.Join`:

- trims and checks its inputs, returning `apperror.Validation` for empty ones;
- opens a transaction and locks the team row (`FOR SHARE`) so a concurrent
  delete cannot slip between the check and the insert;
- writes the membership with an upsert, so a repeat join is harmless;
- inserts the owner's in-app notice and enqueues the email in the **same
  transaction**, so a rolled-back join leaves neither behind;
- returns a sentinel such as `ErrTeamNotFound` rather than `pgx.ErrNoRows`.

Ownership checks for team management (`SetCaptain`, `RemoveMember`) also live
in the repository, inside the transaction (`teamIDForOwner`), so the check and
the write see the same rows. The handler proves _who_ is calling; the
repository proves they may do _this_ to _this_ record.

SQL is always parameterized (`$1`, `$2`). Soft-deleted rows are filtered with
`deleted_at IS NULL` in every read.

### Errors

```go
var ErrTeamNotFound = apperror.New(apperror.KindNotFound, "team_not_found", "team not found")
```

An `apperror` carries a kind, a stable code, and an internal message.
`mapApplicationError` in `httpapi/error_mapper.go` is the only place a kind
becomes a status (validation 400, unprocessable 422, not found 404, conflict
409, authentication 401, authorization 403, too large 413, anything else 500).
Clients see only the code, as `{ "error": "<code>" }`; the message and the
wrapped cause never leave the process. Wrap lower errors with
`fmt.Errorf("join team: %w", err)` so logs say where a failure happened.

The codes are a contract. The web app maps them to copy
(`safeApiErrorMessage` in `apps/web/src/server/api.server.ts`), and
[04 — API](./04-api.md#cross-cutting-api-requirements) lists them. A new code
goes in 04 in the same change.

### Responses

Handlers write domain structs with `writeJSON`. The struct's `json` tags are
the response shape: `json:"-"` keeps a field internal (`CreatedAt` on
`teams.Team`), and `omitempty` drops viewer-specific fields when they do not
apply (`viewer_role`, `members`). The web BFF strips fields it does not use,
but that is a second line of defense: the API must not send what the caller is
not allowed to see.

### Side effects

- **Email** is never sent during a request. A repository inserts a row into
  `email_outbox` inside its transaction, with an idempotency key, and the
  worker started in `cmd/api/main.go` delivers it through Resend. Templates go
  through `internal/emaillayout`.
- **In-app notifications** use `notifications.Insert` in the same transaction.
- **Background loops** (the maintenance sweeper, club confirmation reminders,
  the school catalog refresh) start in `cmd/api/main.go` or `NewRouter` and
  stop with the process context.

### Logging

`main` installs `redact.NewLogger`, which strips personal data and secrets from
`slog` output. Log operation names, ids, and error values; never request
bodies, email addresses, passwords, or tokens.

## Security and permissions

The rules are in [07 — Permissions](./07-permissions.md). How the code applies
them:

| Concern          | Where it is handled                                                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Authentication   | `auth.WithSession` (opaque cookie, hashed lookup) and `auth.RequireUser` in each handler that needs a user. A failed session lookup is a 503, not anonymous. |
| Authorization    | The handler or repository, against the database, in the transaction that writes. Never from a request field naming the actor.                                |
| Validation       | `ValidateXInput` functions in the domain package, plus CHECK constraints in the schema that match them ([03](./03-database.md)).                             |
| Content policy   | `safety.ContainsBlockedLanguage` on user-authored text before it is stored.                                                                                  |
| Rate limits      | `allowVisitor` and `allowAccount` in `httpapi`; which actions are limited is in [04](./04-api.md#cross-cutting-api-requirements).                            |
| Idempotency      | `Idempotency-Key` on create endpoints, stored with the record so a retry returns the first result.                                                           |
| Visitor identity | Trusted only with the shared proxy secret (`visitor_identity.go`).                                                                                           |
| Secrets in logs  | `redact` logger; `apperror` messages stay internal.                                                                                                          |

### The Admin API

`internal/adminhttp` serves `/admin/v1` with stricter rules, described in
[20](./20-admin-console-v1-engineering-plan.md) and tested by
[21](./21-admin-console-security-test-plan.md):

- Every route is a row in the route policy table in `adminhttp/handler.go`:
  method, path, required capability, whether it is a mutation, whether it
  needs recent authentication, and a named operation. There is no generic
  CRUD; each operation has its own handler, validation, and audit.
- `withAuthorization` requires an admin session, checks the Cloudflare Access
  identity against the one the session was issued to, and loads a fresh
  active site-admin grant. The actor comes only from that, never from the
  request.
- Mutations need the exact site origin and the CSRF token, and write an audit
  row in the same transaction as the change.
- `route_invariants_test.go` walks the table, so a new route that skips a
  capability, CSRF, or audit fails the build without anyone extending a list.

## The database

Schema intent and conventions are in [03 — Database](./03-database.md);
`db/migrations` is authoritative. The workflow is in
[`db/migrations/README.md`](../db/migrations/README.md).

- Files are `NNNNNN_snake_case.up.sql`, numbered without gaps, and
  forward-only: there are no down migrations. To undo, write a new migration.
  `pnpm run check:migrations` enforces the naming and numbering.
- Each file runs in one transaction, so `CREATE INDEX CONCURRENTLY` is not
  available.
- Every foreign key ships with an index that leads with its columns
  (`TestSchemaInvariants` fails otherwise), and every new free-text column
  ships with a length CHECK that matches its API validator.
- Add the migration's row, with its deploy order, to the table in the
  migrations README, and update [03](./03-database.md) when the schema's
  intent changes.
- Compose runs `migrate` and then `seed` before the API starts, so
  `pnpm run compose:up` always serves the latest schema.

## Adding an endpoint

Say the task is `GET /teams/{slug}/schedule`. Work in this order.

1. **Read the issue and the owning docs.** Check the "Done when" line. Find
   the rule in [01](./01-product.md) or [02](./02-domain-model.md) and the
   permission in [07](./07-permissions.md). If the issue is labeled
   `needs-spec` or `needs-human`, stop. If a decision is listed in
   [08 — Open questions](./08-open-questions.md), ask first.
2. **Write the contract in 04 first.** Add the route row to
   [04 — API](./04-api.md) (method, path in backticks, `:name` parameters) with
   its fields, statuses, and error codes. `api_docs_test.go` fails until the
   doc and the router agree, so the doc cannot drift.
3. **Schema, if needed.** Add a migration with its indexes and CHECKs, its
   row in the migrations README, and the change in 03.
4. **Domain package.** Add the repository method to the `Repository` interface
   and to `PostgresRepository`: validate inputs, use a transaction for any
   write, check permission against the data in that transaction, and return
   sentinel `apperror` values. Add a new sentinel only when a client needs to
   tell the case apart.
5. **Handler.** Register a pattern route in `registerPublicRoutes` (or the
   area's `registerXRoutes`), then write the handler in the area's
   `*_handlers.go` in the shape above. Choose the rate limit and fallback code
   deliberately. If the handler needs a new dependency, add it to `Router` and
   wire it in `NewRouter`.
6. **Tests** (next section).
7. **Checks.** `pnpm run fmt:api`, `vet:api`, `test:api` with the database set,
   and `check:migrations` for a schema change.
8. **The web side.** Add the response schema and operation in the web slice
   (see [26](./26-frontend-onboarding.md#building-a-new-page)). Add any new
   error code to the web's message map.

For an Admin API operation, add a route policy row with its capability and
operation name, a handler in `adminhttp`, the audit write in the same
transaction, and the route row in [20](./20-admin-console-v1-engineering-plan.md).

## Testing

Unit tests run with `pnpm run test:api` (`go test ./...`). Follow the
neighboring tests for the area:

- **Handler tests** (`httpapi/*_handlers_test.go`) build a `Router` with fake
  repositories from `router_fixtures_test.go` and drive it with `httptest`.
  Assert the status, the error code, and the decoded body as a whole value.
  Cover the anonymous case, the rate limit, malformed input, and each error
  kind the repository can return.
- **Database tests** (`*_db_test.go`) get a private, migrated schema with
  `dbtest.NewMigratedSchemaPool(t, "prefix")`, insert their own fixtures, and
  exercise the real SQL. They prove what fakes cannot: locks, upserts,
  constraints, soft-delete filtering, and that a side effect was written in
  the same transaction. They skip unless `API_DATABASE_URL` is set; with the
  Compose stack up, use
  `postgres://cgn:cgn@localhost:5432/cgn?sslmode=disable`.
- **Contract tests**: `api_docs_test.go` (routes versus 04) and the Admin API
  route invariants run with everything else.

Tests must be deterministic: inject the clock (`PostgresRepository.now`)
rather than sleeping, and construct the exact rows a case needs. Each test
must fail if the behavior it names broke; see `AGENTS.md`, "Test value".

## Checking that it works

```bash
pnpm run compose:up                      # API on :8080, Postgres on :5432
curl -s localhost:8080/health            # liveness
curl -s localhost:8080/ready             # database reachable
curl -s localhost:8080/teams | jq
docker compose logs -f api               # one line per request, redacted
```

The seed creates a verified account (`dev@campusgamingnetwork.test`,
`Password12345!`); log in through the web app at `localhost:3000` and copy the
session cookie to call authenticated routes with curl. `pnpm run seed:demo`
adds thousands of users, events, and teams for list and pagination work.

To look at the data directly:

```bash
docker compose exec postgres psql -U cgn cgn
```

## Before opening a pull request

- Branch from `next`, target `next`, and write `Closes #<issue>`.
- `pnpm run fmt:api`, `vet:api`, and `test:api` pass, with `API_DATABASE_URL`
  set so the database tests run.
- `check:migrations` passes for a schema change.
- 04 lists the route, fields, statuses, and error codes; 03 and the migrations
  README reflect any schema change; 07 reflects any permission change.
- No personal data or secrets in logs, fixtures, or error messages.
- The rest of the review checklist in `CLAUDE.md` holds.
