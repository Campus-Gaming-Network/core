# 23 — Admin Console alerts, drills, and incident runbook

**Status:** Draft — the drills were rehearsed locally on 2026-09-30; every drill
below still has to be repeated in staging before production is enabled
**Audience:** Operators and incident responders

This runbook covers what to watch, how to contain a problem, and how to recover.
Access and recovery of administrator accounts is in
[22 — Admin Console access runbook](./22-admin-console-access-runbook.md); the
control design is in [20 — Admin Console v1 engineering plan](./20-admin-console-v1-engineering-plan.md).

## What the console records

| Signal             | Where                         | Holds                                                                                          |
| ------------------ | ----------------------------- | ---------------------------------------------------------------------------------------------- |
| Audit history      | `audit_logs` table            | One row per committed mutation: actor, session, action, entity, request id, before/after state |
| Security events    | `admin_security_events` table | Exchange, step-up, logout, revocation, authorization denial, and sensitive-read events         |
| Request log        | API stdout                    | One line per request: method, route template, status, request id, verified actor, duration     |
| Failed-request log | API stdout at error level     | `admin request failed` with `error_class` for every Admin API 5xx                              |

The request log never holds cookies, headers, query strings, or bodies. An
unmatched path is truncated to 200 characters, and control characters are
escaped, so a hostile request cannot forge or flood a line. Audit rows are not
application logs: do not search them for errors.

Every Admin API response carries `X-Request-ID`. The same value is in the
request log line, the audit row, and the security event, so one id ties a
report to all three.

## Alerts

Five rules are evaluated from the database by `cgn-admin security-report`, and
three from the request log.

### Database rules

Run the report on a schedule — every five minutes is enough — from the API
image with `API_DATABASE_URL` injected as in
[22](./22-admin-console-access-runbook.md#safety-rules):

```bash
cgn-admin security-report
```

It prints one line per rule (name, count, threshold, window, status) and exits
`0` when every rule is quiet or `3` when any is firing. A scheduler that alerts
on a non-zero exit needs nothing else.

| Rule                         | Fires when, in any 15 minutes                        | Usually means                                                     | First response                                                                  |
| ---------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `access_validation_failures` | 5 or more exchanges with an invalid Access assertion | Something is reaching the console with forged or stale assertions | Check the Access policy and whether the origin is reachable around Cloudflare   |
| `step_up_failures`           | 3 or more refused step-ups                           | An operator cannot confirm identity, or a session is being probed | Ask the operator; if unexplained, revoke their sessions                         |
| `denied_authorization`       | 20 or more authorization denials                     | A script, a stale client, or a probe walking the routes           | Read the events by actor and reason; revoke the actor's sessions if unexplained |
| `rate_limited`               | Any `rate_limited` denial                            | An operator or client is hitting a limit                          | Identify the actor from the event; a sustained burst is abuse                   |
| `unusual_session_creation`   | 10 or more successful exchanges                      | Repeated sign-ins, or a session-creation loop                     | Identify the actor; check for a client retry loop                               |

The thresholds are in `admincommand.DefaultAlertRules`. They are low on
purpose: the console has a handful of operators, so a burst is worth a look.
Tune them only with a recorded reason.

### Request-log rules

Search the API's log stream for these. The format is key=value text, for
example `level=ERROR msg="admin request failed" method=POST path=/admin/v1/reports/{id} status=500 request_id=… error_class=audit_write_failed`.
Confirm the exact filter syntax of the log tool in staging.

| Rule               | Filter                           | Severity                  | First response                                                                                                                                       |
| ------------------ | -------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Audit write failed | `error_class=audit_write_failed` | Page now, on any          | A mutation was refused because it could not be audited, so nothing changed. Check database health and the `audit_logs` table; see the incident steps |
| Admin server error | `msg="admin request failed"`     | Page above 5 in 5 minutes | Read `error_class` and `path`; check the database and R2 before the deploy                                                                           |
| Recovered panic    | `msg="panic recovered"`          | Page now, on any          | Collect the request id and stack from the log; roll back the release if it repeats                                                                   |

An audit-write failure is the only alert that is safe by construction and
still urgent: the console refuses to mutate without recording, so it is failing
closed. Treat the cause as an outage of the audit store.

### Dashboard

Create a read-only view from these queries. Run them as a role that can only
`SELECT` from the two tables.

```sql
-- Security events by hour, type, and reason, last 24 hours.
SELECT date_trunc('hour', occurred_at) AS hour, event_type, outcome,
       metadata ->> 'reason_code' AS reason, count(*)
FROM admin_security_events
WHERE occurred_at > now() - interval '24 hours'
GROUP BY 1, 2, 3, 4 ORDER BY 1 DESC, 5 DESC;

-- Who is acting: mutations by actor and action, last 7 days.
SELECT actor_user_id, action, count(*)
FROM audit_logs
WHERE created_at > now() - interval '7 days'
GROUP BY 1, 2 ORDER BY 3 DESC;

-- Sessions ended, and why, last 7 days.
SELECT date_trunc('day', occurred_at) AS day, metadata ->> 'reason_code' AS reason,
       sum((metadata ->> 'revoked_session_count')::int) AS sessions_ended
FROM admin_security_events
WHERE event_type = 'admin.session.revoked' AND occurred_at > now() - interval '7 days'
GROUP BY 1, 2 ORDER BY 1 DESC;

-- Active administrators and open sessions right now.
SELECT count(*) FILTER (WHERE revoked_at IS NULL) AS active_grants FROM site_role_grants;
SELECT count(*) AS open_sessions FROM admin_sessions
WHERE revoked_at IS NULL AND idle_expires_at > now() AND absolute_expires_at > now();
```

## Containment

Choose the smallest step that stops the harm, then escalate.

| Situation                                | Step                                                                                                                              | Effect                                                                                  |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| One operator's session looks wrong       | `cgn-admin revoke-sessions --email … --actor-email … --reason …`                                                                  | Ends that account's admin sessions; the grant stays                                     |
| One operator should lose access          | `cgn-admin revoke-site-admin --email … --actor-email … --reason …`                                                                | Ends the grant and every session together; refused for the last administrator           |
| An operator's account is compromised     | Suspend the account in the console (needs a recent identity confirmation), then revoke its grant                                  | Ends the account's admin and public sessions                                            |
| The console itself may be compromised    | Kill switch: set `ADMIN_ENABLED=false` on the API and redeploy, then disable the Cloudflare Access application for the admin host | Every `/admin/v1/*` route answers `404`; the public site, health, and readiness stay up |
| The Access policy may have been bypassed | Disable the Access application route first, then the kill switch; revoke all sessions after                                       | No path to the console remains while you investigate                                    |

Do not expose a bypass page, and do not edit grant or session rows by hand.

### Kill switch order

1. Set `ADMIN_ENABLED=false` on the API service and redeploy it.
2. Confirm the API answers `404` to `/admin/v1/session`, the console shows its
   unavailable page with no data, and the public site and `/ready` stay healthy.
3. If authentication or authorization is involved, disable the Access
   application route too. Then end the administrators' sessions: `cgn-admin`
   talks to the database directly and does not need `ADMIN_ENABLED`, so run
   `cgn-admin revoke-sessions` for each account that `cgn-admin list-site-admins`
   shows.
4. To re-enable, set `ADMIN_ENABLED=true`, run
   `cgn-admin validate-access-config`, redeploy, and complete a fresh sign-in.

## Releasing the API and the console together

The API refuses a session request that does not carry the Access identity the
console verified, and the console verifies it on every request. A console
without this behavior in front of an API with it, or the reverse, fails closed:
every authenticated request is refused with `401` until both run the same
release. Deploy them in one window. During a rollback, roll both back.

The console also refuses, with `403`, any request that carries no valid Access
assertion except `/api/health`. Point platform health checks at that path, and
expect a synthetic monitor that hits any other path to be refused.

## Secret rotation

| Secret                                  | Rotate when                                   | Order                                                                                                                                       |
| --------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `ADMIN_API_PROXY_SHARED_SECRET`         | Suspected exposure, or on the agreed schedule | Generate a new value; set it on the Admin BFF and the API in the same deploy window; confirm a fresh sign-in; never reuse the public secret |
| Cloudflare Access audience or team keys | The Access application is recreated           | Update `CLOUDFLARE_ACCESS_*` on both services, run `cgn-admin validate-access-config`, redeploy, sign in again                              |
| R2 access key for logo storage          | Suspected exposure, or on the agreed schedule | Create a new key, update `R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`, redeploy, upload a test logo, then delete the old key                   |
| Database credentials                    | Suspected exposure                            | Runtime and migration credentials rotate separately; the runtime role must stay unable to update or delete audit rows                       |

A retired secret must never go back into logs, Git, or a browser response.
After any rotation, re-run the log canary search for the old value.

## Backup and restore

Backups, point-in-time recovery, and restore for the platform are in
[13 — Railway deployment guide](./13-deployment-plan.md). For the console, a
restore is correct only if it also restores the audit history and the grants.

1. Restore into a new database, never over the live one.
2. Compare row counts and digests of `site_role_grants`, `audit_logs`, and
   `admin_security_events` with the source backup's expectations.
3. Run `cgn-admin list-site-admins` against the restored database and confirm
   the expected administrators are active and eligible.
4. Point a disposable API at it, confirm readiness, and confirm the runtime
   role still cannot update or delete audit rows.
5. Expect zero open admin sessions after a restore of an old backup: sessions
   are short-lived, and every operator signs in again.

## Incident response

1. **Declare** an incident commander and open the incident record. Note the
   environment and the time.
2. **Contain** with the table above. Prefer revoking sessions to disabling the
   console; disable the console when you cannot bound the harm.
3. **Preserve.** Before changing anything else, export the `audit_logs` and
   `admin_security_events` rows for the window, and the API log lines by
   request id. Record the ids, not the contents of any report or ticket.
4. **Scope.** From the audit history, list every mutation by the affected actor
   and session. Each row names its request id; the request log ties it to the
   route and status.
5. **Eradicate.** Rotate the secrets that may have been exposed, remove any
   unrecognized grants with `cgn-admin`, and fix the cause.
6. **Recover.** Re-enable, sign in fresh, confirm the alerts are quiet, and
   watch `security-report` for a full window.
7. **Review.** Record what happened, what the alerts did and did not catch, and
   any change to a threshold, a control, or this runbook.

If the last administrator is lost, follow the break-glass process in
[22](./22-admin-console-access-runbook.md#recovery-sequence).

## Drill log

A drill is complete only when it passes in staging. The local rehearsals prove
the commands and the expected output; they do not prove the deployed
environment.

| Drill                       | Local rehearsal, 2026-09-30                                                                                                                                                                                                          | Staging |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| Grant recovery              | Bootstrap created the first administrator; a second bootstrap was refused; a second administrator was granted and revoked; revoking the last administrator was refused; a non-administrator actor was refused                        | Pending |
| Session revocation          | `revoke-sessions` ran and reported its count; the session, grant, and security-event effects are asserted by `TestServiceGrantListRevokeSessionsAndRevokeGrant` and `TestRevokingAGrantAuditsTheSessionsItEndedWithoutTokenMaterial` | Pending |
| Kill switch                 | With `ADMIN_ENABLED=true` the session route answered `401` and exchange `405`; with `false` both answered `404` while `/health` and `/ready` stayed `200`                                                                            | Pending |
| Backup and restore          | A custom-format dump restored into a new database with identical counts and digests for grants and audit history, and `list-site-admins` showed the expected administrator                                                           | Pending |
| Runtime role cannot rewrite | A role granted only `SELECT` and `INSERT` could read both tables and was refused `UPDATE`, `DELETE`, and `TRUNCATE` on each                                                                                                          | Pending |
| Alert evaluation            | `security-report` exited `0` when quiet and `3`, naming the rule, after six forged-assertion denials                                                                                                                                 | Pending |
| Secret rotation             | Not rehearsed locally: it needs two live services and a real Access application                                                                                                                                                      | Pending |
| Access bypass attempt       | The local stand-in is covered by the real-stack suite; the real origin needs staging                                                                                                                                                 | Pending |
