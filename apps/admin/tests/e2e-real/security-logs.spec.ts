import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { accessAssertion, forgeAssertion } from "./fixtures/access.js";
import {
  adminOrigin,
  adminProxySecret,
  apiURL,
  exchangeSession,
  proxyHeaders,
  publicProxySecret,
} from "./fixtures/admin-api.js";

const logDirectory = process.env.ADMIN_REAL_E2E_LOG_DIR ?? "";
const operatorEmail = "operator@admin-real.test";
const reportID = "40000000-0000-4000-8000-000000000001";
const schoolID = "10000000-0000-4000-8000-000000000001";

// Unique values that must never appear in a log line.
const canary = (label: string) => `canary-${label}-7f3a9c1e`;

function readLogs(): { api: string; admin: string } {
  return {
    api: readFileSync(`${logDirectory}/api.log`, "utf8"),
    admin: readFileSync(`${logDirectory}/admin.log`, "utf8"),
  };
}

test("LOG-01: secrets, tokens, and bodies never reach the API or console logs", async ({
  browser,
  request,
}) => {
  const session = await exchangeSession(request, operatorEmail);
  const assertion = accessAssertion(operatorEmail);
  const adminToken =
    session.cookieHeader
      .split("; ")
      .find((cookie) => cookie.startsWith("cgn_admin_session="))
      ?.split("=")[1] ?? "";
  const privateKeyBody = (process.env.ADMIN_REAL_E2E_PRIVATE_KEY ?? "")
    .split("\n")
    .filter((line) => line && !line.startsWith("-----"))[1];
  const reportURL = `${apiURL}/admin/v1/reports/${reportID}`;
  const current = await (
    await request.get(reportURL, { headers: session.readHeaders })
  ).json();

  // Success: an audited write whose note is a canary.
  const success = await request.patch(reportURL, {
    headers: { ...session.mutationHeaders, "Content-Type": "application/json" },
    data: {
      status: "in_review",
      resolution_note: canary("note-body"),
      expected_updated_at: current.updated_at,
    },
  });
  expect(success.status()).toBe(200);

  // Rejections: bad CSRF with a body, a forged assertion, wrong proxy proofs,
  // malformed JSON, a rejected upload, hostile cookies and headers.
  await Promise.all([
    request.patch(reportURL, {
      headers: {
        ...session.mutationHeaders,
        "X-CGN-Admin-CSRF": canary("bad-csrf"),
        "Content-Type": "application/json",
      },
      data: { resolution_note: canary("rejected-body") },
    }),
    request.patch(reportURL, {
      headers: {
        ...session.mutationHeaders,
        "Content-Type": "application/json",
      },
      data: `{"resolution_note": "${canary("malformed-body")}"`,
    }),
    request.post(`${apiURL}/admin/v1/auth/exchange`, {
      headers: {
        ...proxyHeaders,
        Origin: adminOrigin,
        "Cf-Access-Jwt-Assertion": forgeAssertion({
          email: `${canary("forged-email")}@admin-real.test`,
          signWith: "attacker",
        }),
      },
    }),
    request.get(`${apiURL}/admin/v1/session`, {
      headers: { "X-CGN-Admin-Proxy-Secret": canary("wrong-proxy-secret") },
    }),
    request.get(`${apiURL}/admin/v1/session`, {
      headers: {
        ...proxyHeaders,
        Authorization: `Bearer ${canary("authorization")}`,
        Cookie: `cgn_session=${canary("public-session")}; cgn_admin_session=${canary("stale-admin-session")}`,
      },
    }),
    request.post(`${apiURL}/admin/v1/schools/${schoolID}/logo`, {
      headers: session.mutationHeaders,
      multipart: {
        reason: "Log check",
        expected_updated_at: "2000-01-01T00:00:00Z",
        file: {
          name: "logo.png",
          mimeType: "image/png",
          buffer: Buffer.from(canary("upload-bytes")),
        },
      },
    }),
  ]);

  // The same kind of hostile traffic through the console.
  const context = await browser.newContext({
    extraHTTPHeaders: {
      "Cf-Access-Jwt-Assertion": assertion,
      Authorization: `Bearer ${canary("browser-authorization")}`,
    },
  });
  await context.addCookies([
    {
      name: "cgn_session",
      value: canary("browser-public-session"),
      domain: "127.0.0.1",
      path: "/",
    },
  ]);
  const page = await context.newPage();
  await page.goto(`/reports/${reportID}?q=${canary("query")}`);
  await context.close();

  // A marker request proves the API has logged everything before it.
  await request.get(`${apiURL}/admin/v1/logtest-final`, {
    headers: proxyHeaders,
  });
  await expect
    .poll(() => readLogs().api, { timeout: 10_000 })
    .toContain("logtest-final");

  const logs = readLogs();
  // Not vacuous: the logs record the traffic, only without its secrets.
  expect(logs.api).toContain("/admin/v1/auth/exchange");
  expect(logs.api).toContain("/admin/v1/reports/");

  const secrets = [
    adminToken,
    session.csrf,
    assertion,
    assertion.split(".")[2],
    adminProxySecret,
    publicProxySecret,
    privateKeyBody,
    ...[
      "note-body",
      "bad-csrf",
      "rejected-body",
      "malformed-body",
      "forged-email",
      "wrong-proxy-secret",
      "authorization",
      "public-session",
      "stale-admin-session",
      "upload-bytes",
      "browser-authorization",
      "browser-public-session",
      "query",
    ].map(canary),
  ];
  for (const secret of secrets) {
    expect(secret.length).toBeGreaterThan(8);
    expect(logs.api, "API log").not.toContain(secret);
    expect(logs.admin, "console log").not.toContain(secret);
  }
});
