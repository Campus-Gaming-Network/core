# 22 — Admin Console access and recovery runbook

**Status:** Draft — staging drill required
**Last updated:** 2026-09-16
**Audience:** Production operators and incident responders

This runbook covers the non-networked `cgn-admin` command used to establish and
recover site-administrator access. It does not bypass the application
invariants: the target must be an active, verified CGN account, normal grant
changes require an active site administrator, and the final active site
administrator cannot be revoked.

## Safety rules

- Run the command from an approved operator shell using the deployed API image
  or a binary built from the production revision.
- Inject `API_DATABASE_URL` through the platform's secret environment. Never
  put a database password, Access assertion, session token, or other credential
  in command arguments, shell history, tickets, or chat.
- Confirm the target environment, target account, acting administrator, and
  reason before running a mutation.
- Use a concise operational reason. Do not include support messages, report
  text, passwords, tokens, or other sensitive body content.
- Capture the command result and matching audit/security-event identifiers in
  the change or incident record. Do not copy database credentials into it.

The command refuses database-backed operations unless `API_DATABASE_URL` is
explicitly set. It never falls back to the local development database URL.

## Validate the Access configuration

Set the complete enabled Admin Console environment, including
`ADMIN_ENABLED=true`, then run:

```bash
cgn-admin validate-access-config
```

The command validates HTTPS origins, distinct proxy secrets, host-only cookie
names, bounded session lifetimes, and the Cloudflare Access issuer, audience,
and JWKS URL. It does not print secret values.

## Bootstrap the first site administrator

Bootstrap is available only while there are zero active `site_admin` grants.
Set `CGN_ADMIN_OPERATOR_IDENTITY` to the approved human/operator identity in the
environment, not a command argument:

```bash
export CGN_ADMIN_OPERATOR_IDENTITY="operator@example.com"
cgn-admin grant-site-admin \
  --bootstrap \
  --email "first.admin@example.com" \
  --reason "Initial production Admin Console bootstrap"
```

The grant, domain audit, and `admin.access.bootstrap` security event commit in
one database transaction. A second bootstrap attempt fails.

## Grant another site administrator

```bash
cgn-admin grant-site-admin \
  --email "new.admin@example.com" \
  --actor-email "current.admin@example.com" \
  --reason "Approved on-call coverage"
```

The acting account must hold an active site-admin grant. The target account must
already exist, be active, and have a verified email address matching the
Cloudflare Access identity it will use.

## List active site administrators

```bash
cgn-admin list-site-admins
```

The output contains one tab-separated row per active grant: email, user ID,
grant ID, account status, and current eligibility. Suspended or otherwise
ineligible accounts remain visible so their lingering grant can be investigated
or revoked. Store the output only in the approved operator record.

## Revoke site-administrator access

```bash
cgn-admin revoke-site-admin \
  --email "departing.admin@example.com" \
  --actor-email "current.admin@example.com" \
  --reason "Access no longer required"
```

The grant revocation and all active Admin Console session closures for the
target commit together. The command refuses to revoke the last active site
administrator. There is no normal CLI flag that disables that guard.

## Revoke questionable sessions

This operation leaves the role grant active and closes all current Admin
Console sessions for the target:

```bash
cgn-admin revoke-sessions \
  --email "admin@example.com" \
  --actor-email "current.admin@example.com" \
  --reason "Identity provider recovery drill"
```

The session updates and `admin.session.revoked` security event commit in one
transaction. The operator should then have the target sign in through
Cloudflare Access again.

## Recovery sequence

1. Confirm the incident commander and exact staging or production environment.
2. Restore the operator's phishing-resistant IdP and Cloudflare Access group
   membership.
3. Confirm the CGN account is active and its email is verified.
4. Have another active site administrator grant access with `cgn-admin`. If no
   grant has ever existed, use the one-time bootstrap procedure.
5. Revoke all questionable Admin Console sessions for the recovered account.
6. Validate the Access configuration and complete a fresh sign-in.
7. Verify the grant audit, security events, and session revocation count.
8. Record the outcome without copying credentials or sensitive request data.

If the last administrator is unavailable after initial bootstrap, stop and use
the separately controlled break-glass process. V1 intentionally does not expose
an unreviewed `--force` flag or recommend manual row edits. The break-glass
procedure must be approved, held outside the repository with the production
credentials, and exercised in staging before launch.
