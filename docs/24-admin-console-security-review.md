# 24 — Admin Console security review record (AC-014)

**Status:** Internal review complete, 2026-09-30. The independent review, the
staging penetration pass, and the staging drills are still owed.
**Audience:** Release approvers

This records what was reviewed for AC-014, what it found, and what is decided
or still owed. It is not the independent review: the author of a control cannot
certify it. [21 — Admin Console security test plan](./21-admin-console-security-test-plan.md)
maps every acceptance case to its test, and
[23 — Admin Console operations runbook](./23-admin-console-operations-runbook.md)
holds the alerts and drills.

## Method

- Walked all 77 cases of the security acceptance matrix against the code and
  its tests, and wrote tests for every case that lacked one.
- Drove the built Admin BFF, the real Go API, and PostgreSQL through the eight
  journeys and the real-stack security cases (`pnpm run test:e2e:admin:real`).
- Scanned production dependencies, the compiled binaries, and the full Git
  history for known vulnerabilities and secrets.
- Reviewed CI, container, and platform configuration.
- Rehearsed the recovery, revocation, kill-switch, restore, privilege, and
  alert drills against a disposable database.

## Findings

Severity is the reviewer's judgment of risk if left unfixed. Every item found
during this review is fixed and has a test that fails without the fix.

| ID   | Severity | Finding                                                                                                                                                                                     | Status | Evidence                                                                        |
| ---- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------- |
| F-01 | Medium   | The Admin BFF authorized a request on the admin session cookie alone. The design says every request repeats Access validation, and that a session is bound to the identity it was issued to | Fixed  | ACCESS-07: the BFF verifies the assertion on every call and the API compares it |
| F-02 | Medium   | A request that came around Access reached the application and rendered a sign-in page instead of being refused before rendering                                                             | Fixed  | ACCESS-01: the Access gate in `server.ts`                                       |
| F-03 | Medium   | CI ran no Admin Console check: no typecheck, lint, unit test, browser test, or dependency audit, although the release gates require them                                                    | Fixed  | The `admin` job in `.github/workflows/ci.yml`                                   |
| F-04 | Low      | The Admin API read the proxy secret with `Header.Get`, so the right value followed by a wrong one was accepted                                                                              | Fixed  | TRUST-02                                                                        |
| F-05 | Low      | The BFF refreshed the signing keys for every unknown key id, so a caller could spend a key fetch per request by inventing ids                                                               | Fixed  | ACCESS-05: one refresh per 30-second cooldown                                   |
| F-06 | Low      | The content security policy allowed any inline script (`script-src 'unsafe-inline'`)                                                                                                        | Fixed  | XSS-05: a per-request nonce; injected script cannot run                         |
| F-07 | Low      | Built assets were served `public, max-age=31536000, immutable` with no robots header, against the requirement that every admin response is private and non-indexable                        | Fixed  | HEADER-01, HEADER-02: route rules in `vite.config.ts`                           |
| F-08 | Low      | Revoking a site grant ended its sessions without a security event recording who, whose, and how many                                                                                        | Fixed  | AUDIT-08                                                                        |
| F-09 | Low      | The request log had no status or actor, logged the raw path, and had no way to alert on an audit-write failure or a 5xx                                                                     | Fixed  | LOG-02, LOG-03; the alerts in [23](./23-admin-console-operations-runbook.md)    |
| F-10 | Low      | CI declared no token permissions, so jobs ran with the repository default                                                                                                                   | Fixed  | `permissions: contents: read`                                                   |
| F-11 | Low      | A first visit to a deep link exchanged the Access assertion but loaded the page without the new cookies, so the page failed until a reload (found earlier in AC-014)                        | Fixed  | Journey 1 deep-links first                                                      |

No critical or high finding is open.

## Decisions on what is left open

Each item has an owner and a release decision. "Not a blocker" means the
Admin Console may ship with it open; it does not mean it may be forgotten.

| ID  | Severity | Item                                                                                                                                                                     | Owner            | Decision                                                                                                                      |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| O-1 | Low      | `golang.org/x/crypto` v0.57.0 carries GO-2026-5932, which has no fixed version. `govulncheck` reports that neither binary calls it                                       | API maintainer   | Accept. Re-run the scan on every release and upgrade when a fix ships                                                         |
| O-2 | Moderate | Five advisories (`vite`, `esbuild`, `dompurify`) in `apps/docs` development tooling (`vitepress`, `mermaid`). The production audit of every shipped application is clean | Docs maintainer  | Not a blocker: the packages do not ship with the web app or console. Upgrade `vitepress` when a release picks up patched ones |
| O-3 | Low      | Container base images are pinned by tag (`node:24-alpine`, `golang:1.27.1-alpine3.24`, `alpine:3.24`), not by digest                                                     | Deploy owner     | Not a blocker. Pin by digest with automated updates when image automation is chosen                                           |
| O-4 | Low      | No automated dependency update service is configured                                                                                                                     | Repository owner | Not a blocker. Adopt Dependabot or Renovate; the audits above are manual until then                                           |
| O-5 | Medium   | The API's rate limiters are process-local, so the API must run one replica or the limits multiply                                                                        | Deploy owner     | Accept for v1 with one replica, which [13](./13-deployment-plan.md) assumes. A shared store is a prerequisite for scaling out |
| O-6 | Low      | `style-src 'unsafe-inline'` remains because React renders inline style attributes                                                                                        | Admin maintainer | Accept. Style injection cannot execute script under the current policy; revisit if the framework supports nonce styles        |
| O-7 | Low      | The log canary test does not exercise timeout or panic paths                                                                                                             | Admin maintainer | Accept. The panic path logs only the panic value and stack; add a canary case when a test hook for injecting one exists       |

## Dependency review

| Scope                                   | Tool and date                          | Result                                                                                                        |
| --------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Production JavaScript, all applications | `pnpm audit --prod`, 2026-09-30        | No known vulnerabilities                                                                                      |
| All JavaScript including development    | `pnpm audit`, 2026-09-30               | Five advisories, all in `apps/docs` tooling (O-2)                                                             |
| Go API and `cgn-admin` binaries         | `govulncheck -mode=binary`, 2026-09-30 | No reachable vulnerabilities. One advisory with no fix in a required module that the code does not call (O-1) |
| Go modules                              | `go get golang.org/x/crypto@v0.57.0`   | Upgraded from v0.54.0, which carried three fixable advisories; the remaining one has no fix                   |

`govulncheck`'s source mode could not load the Go 1.27 module with the Go 1.26
toolchain that builds its current release, so the binaries were scanned
instead. That covers what ships.

## Secret review

- **History and tree.** `gitleaks` scanned 151 commits and reported seven
  matches. All are test fixtures: five idempotency keys in unit tests, and two
  fixed hexadecimal placeholders in a container-gate script. None is a
  credential.
- **Configuration.** The example environment and the Compose defaults hold
  local-only placeholders. Staging and production refuse to start with a
  missing, short, reused, or default secret, each case tested in both
  environments and without repeating any value (see [21](./21-admin-console-security-test-plan.md), TRUST-01).
- **Runtime.** LOG-01 plants canaries in cookies, tokens, assertions, proxy
  secrets, the signing key, bodies, and upload bytes, across success and
  rejection paths, and finds none in the API or console logs. LOG-05 confirms
  the console loads no third-party analytics or error tracking.
- **Browser.** TRUST-03 confirms neither proxy secret appears in any page,
  script, header, or cookie the browser receives.

## Configuration review

- CI now declares read-only token permissions. Third-party actions are pinned by
  commit; first-party actions by major version.
- The API and console containers run as non-root users (`cgn` and `node`).
- The API's Railway configuration migrates before deploy and checks `/ready`.
- In strict environments the API refuses to start the console if its database
  role owns or can modify the audit tables.

## Still owed before production is enabled

These cannot be done from a development machine, or cannot be done by the
author of the controls.

1. **Independent review.** A person or firm that did not write the console
   reviews the code and this record, and their findings are triaged here.
2. **Staging penetration pass.** Against the deployed Access application and
   the direct Railway origin.
3. **Staging drills.** Every drill in [23](./23-admin-console-operations-runbook.md#drill-log),
   plus secret rotation and an Access bypass attempt.
4. **Deployment smoke.** The staging checklist in [21](./21-admin-console-security-test-plan.md#deployment-smoke-and-rollback-checklist),
   including ACCESS-01 and ACCESS-08 on the real origin, TRUST-06, UPLOAD-07,
   and the production HTTPS headers (HEADER-03, HEADER-05, XSS-05).
5. **A sign-off** recording the commit, the evidence, and a named decision on
   any medium finding the independent review raises.
