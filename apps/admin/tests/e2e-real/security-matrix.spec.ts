import http from "node:http";
import { expect, test, type Browser, type Page } from "@playwright/test";
import {
  accessAssertion,
  forgeAssertion,
  signInThroughAccess,
} from "./fixtures/access.js";
import {
  adminOrigin,
  adminProxySecret,
  apiURL,
  exchangeSession,
  proxyHeaders,
  publicProxySecret,
  setCookies,
} from "./fixtures/admin-api.js";
import { panel, runCommand, signInSteppedUp } from "./fixtures/console.js";

const operatorEmail = "operator@admin-real.test";
const memberEmail = "member@admin-real.test";
const reportID = "40000000-0000-4000-8000-000000000001";
const supportTicketID = "40000000-0000-4000-8000-000000000002";
const loggedOutAdmin = "loggedout@admin-real.test";
const suspendedAdmin = {
  email: "suspended@admin-real.test",
  id: "30000000-0000-4000-8000-000000000008",
};
const revokedAdmin = {
  email: "revoked@admin-real.test",
  id: "30000000-0000-4000-8000-000000000009",
};

async function expectNoConsole(page: Page) {
  await expect(
    page.getByRole("navigation", { name: "Admin navigation" }),
  ).toHaveCount(0);
  expect(
    (await page.context().cookies()).filter((cookie) =>
      cookie.name.startsWith("cgn_admin"),
    ),
  ).toEqual([]);
}

// Opens the console in a fresh browser context that sends `headers`, as a
// hostile client in front of the BFF could.
async function visitAs(
  browser: Browser,
  headers: Record<string, string>,
  cookies: { name: string; value: string }[] = [],
): Promise<Page> {
  const context = await browser.newContext({ extraHTTPHeaders: headers });
  await context.addCookies(
    cookies.map((cookie) => ({
      ...cookie,
      domain: "127.0.0.1",
      path: "/",
    })),
  );
  const page = await context.newPage();
  await page.goto("/reports");
  return page;
}

test("the harness accepts a genuine assertion", async ({ request }) => {
  const session = await exchangeSession(request, operatorEmail);
  expect(session.csrf).not.toBe("");
});

// ACCESS-02
const forgedAssertions: { name: string; assertion: string }[] = [
  { name: "arbitrary text", assertion: "not-a-jwt" },
  {
    name: "a self-signed token under the real key id",
    assertion: forgeAssertion({ email: operatorEmail, signWith: "attacker" }),
  },
  {
    name: "a valid signature from another key under its own key id",
    assertion: forgeAssertion({
      email: operatorEmail,
      signWith: "attacker",
      keyID: "attacker-key",
    }),
  },
  {
    name: "alg none",
    assertion: forgeAssertion({ email: operatorEmail, alg: "none" }),
  },
  {
    name: "an HS256 token keyed with the public key",
    assertion: forgeAssertion({ email: operatorEmail, alg: "HS256" }),
  },
  {
    name: "an unknown key id",
    assertion: forgeAssertion({ email: operatorEmail, keyID: "unknown-key" }),
  },
  {
    name: "an expired token",
    assertion: forgeAssertion({ email: operatorEmail, expiresIn: -600 }),
  },
  {
    name: "a token for another audience",
    assertion: forgeAssertion({ email: operatorEmail, audience: "other-app" }),
  },
  {
    name: "a token from another issuer",
    assertion: forgeAssertion({
      email: operatorEmail,
      issuer: "https://evil.cloudflareaccess.com",
    }),
  },
  {
    name: "a token that is not yet valid",
    assertion: forgeAssertion({ email: operatorEmail, notBefore: 3600 }),
  },
];

for (const { name, assertion } of forgedAssertions) {
  test(`ACCESS-02: ${name} is refused by the API and the console`, async ({
    browser,
    request,
  }) => {
    const response = await request.post(`${apiURL}/admin/v1/auth/exchange`, {
      headers: {
        ...proxyHeaders,
        Origin: adminOrigin,
        "Cf-Access-Jwt-Assertion": assertion,
      },
    });
    expect(response.status()).toBe(401);
    expect(setCookies(response)).toEqual([]);

    const page = await visitAs(browser, {
      "Cf-Access-Jwt-Assertion": assertion,
    });
    await expectNoConsole(page);
    await page.context().close();
  });
}

// ACCESS-06
const forgedIdentityHeaders = {
  "Cf-Access-Authenticated-User-Email": operatorEmail,
  "X-Forwarded-Email": operatorEmail,
  "X-Forwarded-User": operatorEmail,
  "X-Forwarded-For": "203.0.113.9",
  "X-CGN-Admin-Principal": operatorEmail,
  "X-CGN-Admin-Proxy-Secret": "forged-secret",
};

test("ACCESS-06: identity headers alone never create a session", async ({
  browser,
  request,
}) => {
  const response = await request.post(`${apiURL}/admin/v1/auth/exchange`, {
    headers: {
      ...proxyHeaders,
      Origin: adminOrigin,
      ...forgedIdentityHeaders,
      "X-CGN-Admin-Proxy-Secret": adminProxySecret,
    },
  });
  expect(response.status()).toBe(401);
  expect(setCookies(response)).toEqual([]);

  const page = await visitAs(browser, forgedIdentityHeaders);
  await expectNoConsole(page);
  await page.context().close();
});

test("ACCESS-06: a genuine assertion outranks forged identity headers", async ({
  browser,
}) => {
  const asMember = await visitAs(browser, {
    ...forgedIdentityHeaders,
    "Cf-Access-Jwt-Assertion": accessAssertion(memberEmail),
  });
  await expectNoConsole(asMember);
  await asMember.context().close();

  const asOperator = await visitAs(browser, {
    ...forgedIdentityHeaders,
    "Cf-Access-Authenticated-User-Email": "peer@admin-real.test",
    "Cf-Access-Jwt-Assertion": accessAssertion(operatorEmail),
  });
  await expect(
    asOperator.getByText(operatorEmail, { exact: true }),
  ).toBeVisible();
  await expect(asOperator.getByText("peer@admin-real.test")).toHaveCount(0);
  await asOperator.context().close();
});

// SESSION-02
test("SESSION-02: public, unlock, and sibling cookies never become an admin session", async ({
  browser,
  request,
}) => {
  const strayCookies = [
    { name: "cgn_session", value: "a".repeat(43) },
    { name: "cgn_event_unlock_public-browser-event", value: "b".repeat(43) },
    { name: "sibling_admin", value: "c".repeat(43) },
    { name: "session", value: "d".repeat(43) },
  ];
  const page = await visitAs(browser, {}, strayCookies);
  await expectNoConsole(page);
  await page.context().close();

  const cookie = strayCookies
    .map(({ name, value }) => `${name}=${value}`)
    .join("; ");
  for (const path of ["session", "reports"]) {
    // Sequential to keep each failure attributable to one path.
    // eslint-disable-next-line no-await-in-loop
    const response = await request.get(`${apiURL}/admin/v1/${path}`, {
      headers: { ...proxyHeaders, Cookie: cookie },
    });
    expect(response.status()).toBe(401);
  }
});

test("SESSION-02: an admin session token is not a public session", async ({
  request,
}) => {
  const session = await exchangeSession(request, operatorEmail);
  const adminToken = session.cookieHeader
    .split("; ")
    .find((cookie) => cookie.startsWith("cgn_admin_session="))
    ?.split("=")[1];
  const response = await request.get(`${apiURL}/me`, {
    headers: {
      "X-CGN-Proxy-Secret": publicProxySecret,
      Cookie: `cgn_session=${adminToken}`,
    },
  });
  expect(response.status()).toBe(401);
});

// SESSION-07
test("SESSION-07: a logged-out session cannot be replayed", async ({
  request,
}) => {
  const session = await exchangeSession(request, loggedOutAdmin);
  const before = await request.get(`${apiURL}/admin/v1/session`, {
    headers: session.readHeaders,
  });
  expect(before.status()).toBe(200);

  const logout = await request.post(`${apiURL}/admin/v1/logout`, {
    headers: session.mutationHeaders,
  });
  expect(logout.status()).toBe(204);
  expect(setCookies(logout).join("\n")).toMatch(/cgn_admin_session=;/);

  const replay = await request.get(`${apiURL}/admin/v1/session`, {
    headers: session.readHeaders,
  });
  expect(replay.status()).toBe(401);
});

test("SESSION-07: suspending an account ends its open admin session", async ({
  context,
  page,
  request,
}) => {
  const victim = await exchangeSession(request, suspendedAdmin.email);
  const before = await request.get(`${apiURL}/admin/v1/session`, {
    headers: victim.readHeaders,
  });
  expect(before.status()).toBe(200);

  await signInSteppedUp(context, page, operatorEmail);
  await page.goto(`/users/${suspendedAdmin.id}`);
  await runCommand(panel(page, "Suspend"), "Security suite", "Suspend account");
  await expect(page.getByRole("status")).toHaveText(
    "Account suspended and its sessions ended.",
  );

  const replay = await request.get(`${apiURL}/admin/v1/session`, {
    headers: victim.readHeaders,
  });
  expect(replay.status()).toBe(401);
  const exchange = await request.post(`${apiURL}/admin/v1/auth/exchange`, {
    headers: {
      ...proxyHeaders,
      Origin: adminOrigin,
      "Cf-Access-Jwt-Assertion": accessAssertion(suspendedAdmin.email),
    },
  });
  expect([401, 403]).toContain(exchange.status());
});

// SESSION-10
test("SESSION-10: a mutation with a live token is refused once its grant is revoked", async ({
  context,
  page,
  request,
}) => {
  const operator = await exchangeSession(request, operatorEmail);
  const reportURL = `${apiURL}/admin/v1/reports/${reportID}`;
  const snapshot = await (
    await request.get(reportURL, { headers: operator.readHeaders })
  ).json();

  const victim = await exchangeSession(request, revokedAdmin.email);
  const attempt = {
    status: "closed",
    resolution_note: "Replay after revocation",
    expected_updated_at: snapshot.updated_at,
  };
  // Until the grant is revoked the token is valid, so the request is accepted
  // or rejected on its merits, never as unauthenticated.
  const live = await request.patch(reportURL, {
    headers: { ...victim.mutationHeaders, "Content-Type": "application/json" },
    data: {
      ...attempt,
      status: snapshot.status,
      resolution_note: snapshot.resolution_note,
      expected_updated_at: snapshot.updated_at,
    },
  });
  expect(live.status()).not.toBe(401);

  await signInSteppedUp(context, page, operatorEmail);
  await page.goto("/access/site-admins");
  const grant = page
    .getByRole("listitem")
    .filter({ has: page.getByText(revokedAdmin.id, { exact: true }) });
  await runCommand(
    grant.getByRole("region", { name: "Revoke access" }),
    "Security suite",
    "Revoke site-admin access",
  );
  await expect(page.getByRole("status")).toBeVisible();

  const current = await (
    await request.get(reportURL, { headers: operator.readHeaders })
  ).json();
  const replay = await request.patch(reportURL, {
    headers: { ...victim.mutationHeaders, "Content-Type": "application/json" },
    data: { ...attempt, expected_updated_at: current.updated_at },
  });
  expect(replay.status()).toBe(401);
  const after = await (
    await request.get(reportURL, { headers: operator.readHeaders })
  ).json();
  expect(after).toEqual(current);
});

// CSRF-03
test("CSRF-03: sibling and lookalike origins are refused exactly", async ({
  request,
}) => {
  const session = await exchangeSession(request, operatorEmail);
  const lookalikes = [
    "https://www.campusgamingnetwork.com",
    "https://evil.campusgamingnetwork.com",
    "https://admin.campusgamingnetwork.com.evil.test",
    `${adminOrigin}.evil.test`,
    `${adminOrigin}@evil.test`,
    `http://user:pass@127.0.0.1:3310`,
    "http://127.0.0.1:3311",
    "http://localhost:3310",
    `${adminOrigin}/`,
    "null",
  ];
  const responses = await Promise.all(
    lookalikes.map(async (origin) => ({
      origin,
      api: (
        await request.patch(`${apiURL}/admin/v1/reports/${reportID}`, {
          headers: { ...session.mutationHeaders, Origin: origin },
          data: {},
        })
      ).status(),
      console: (
        await request.post(`${adminOrigin}/step-up`, {
          headers: { origin },
          form: { return: "/" },
        })
      ).status(),
    })),
  );
  expect(responses).toEqual(
    lookalikes.map((origin) => ({ origin, api: 403, console: 403 })),
  );
});

// TRUST-02
function rawRequest(
  path: string,
  headers: Record<string, string | string[]>,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      { host: "127.0.0.1", port: 18090, path, headers },
      (response) => {
        let body = "";
        response.on("data", (chunk) => (body += chunk));
        response.on("end", () =>
          resolve({ status: response.statusCode ?? 0, body }),
        );
      },
    );
    request.on("error", reject);
    request.end();
  });
}

test("TRUST-02: the proxy credential must be present exactly once and correct", async () => {
  const cases: (string | string[] | undefined)[] = [
    undefined,
    "",
    "wrong",
    publicProxySecret,
    [adminProxySecret, adminProxySecret],
    [adminProxySecret, "wrong"],
    ["wrong", adminProxySecret],
  ];
  const results = await Promise.all(
    cases.map((secret) =>
      rawRequest(
        "/admin/v1/session",
        secret === undefined ? {} : { "X-CGN-Admin-Proxy-Secret": secret },
      ),
    ),
  );
  // Every refusal is the same generic response.
  expect(results.map((result) => result.status)).toEqual(cases.map(() => 404));
  expect(new Set(results.map((result) => result.body)).size).toBe(1);
});

// TRUST-03
test("TRUST-03: the server-injected secret never reaches the browser", async ({
  context,
  page,
}) => {
  const seen: string[] = [];
  page.on("response", async (response) => {
    const type = response.headers()["content-type"] ?? "";
    seen.push(JSON.stringify(response.headers()));
    if (/text|json|javascript/.test(type)) {
      seen.push(await response.text().catch(() => ""));
    }
  });
  await signInThroughAccess(context, operatorEmail);
  for (const path of [
    "/",
    "/reports",
    `/reports/${reportID}`,
    `/support-tickets/${supportTicketID}`,
    "/schools",
    "/games",
    "/users",
    "/access/site-admins",
  ]) {
    // Sequential: each navigation is one page load to inspect.
    // eslint-disable-next-line no-await-in-loop
    await page.goto(path);
  }
  const cookies = JSON.stringify(await context.cookies());
  const everything = [...seen, cookies].join("\n");
  expect(everything.length).toBeGreaterThan(1000);
  expect(everything).not.toContain(adminProxySecret);
  expect(everything).not.toContain(publicProxySecret);
});
