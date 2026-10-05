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
const bystanderEmail = "bystander@admin-real.test";
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

// ACCESS-01: the local stand-in for requesting the origin directly.
test("ACCESS-01: a request around Access is refused before anything renders", async ({
  request,
}) => {
  const paths = [
    "/",
    "/reports",
    `/reports/${reportID}`,
    "/step-up",
    "/_serverFn/anything",
    "/assets/missing.js",
  ];
  const forged = forgeAssertion({ email: operatorEmail, signWith: "attacker" });
  const responses = await Promise.all(
    paths.flatMap((path) => [
      request.get(path),
      request.get(path, { headers: { "Cf-Access-Jwt-Assertion": forged } }),
      request.post(path, { headers: { Origin: adminOrigin }, data: "" }),
    ]),
  );
  const bodies = await Promise.all(
    responses.map((response) => response.text()),
  );
  for (const [index, response] of responses.entries()) {
    if (response.url().includes("/assets/")) continue;
    expect(response.status()).toBe(403);
    expect(bodies[index]).toBe("");
    expect(setCookies(response)).toEqual([]);
  }

  // The platform health check needs no assertion and reveals nothing.
  const health = await request.get("/api/health");
  expect(health.status()).toBe(200);
  expect(await health.text()).not.toMatch(/operator|reports|schools/i);
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

// ACCESS-07
test("ACCESS-07: the API refuses a session request its BFF did not vouch for", async ({
  request,
}) => {
  const session = await exchangeSession(request, operatorEmail);
  const cases: {
    name: string;
    headers: Record<string, string>;
    status: number;
  }[] = [
    {
      name: "the issuing identity",
      headers: { ...session.readHeaders },
      status: 200,
    },
    {
      name: "no vouched identity",
      headers: { ...proxyHeaders, Cookie: session.cookieHeader },
      status: 401,
    },
    {
      name: "another identity",
      headers: {
        ...session.readHeaders,
        "X-CGN-Admin-Access-Email": memberEmail,
      },
      status: 401,
    },
    {
      name: "another administrator",
      headers: {
        ...session.readHeaders,
        "X-CGN-Admin-Access-Email": "peer@admin-real.test",
      },
      status: 401,
    },
  ];
  const statuses = await Promise.all(
    cases.map(async ({ headers }) =>
      (await request.get(`${apiURL}/admin/v1/session`, { headers })).status(),
    ),
  );
  expect(statuses).toEqual(cases.map(({ status }) => status));
});

test("ACCESS-07: the console never lets a session cookie stand in for Access", async ({
  browser,
  request,
}) => {
  const session = await exchangeSession(request, operatorEmail);
  const visit = async (headers: Record<string, string>) => {
    const context = await browser.newContext({ extraHTTPHeaders: headers });
    await context.addCookies(
      session.cookies.map(({ name, value }) => ({
        name,
        value,
        domain: "127.0.0.1",
        path: "/",
      })),
    );
    const page = await context.newPage();
    await page.goto("/reports");
    return { context, page };
  };

  // The operator's own cookies, but no Access assertion at all.
  const omitted = await visit({});
  await expect(
    omitted.page.getByRole("navigation", { name: "Admin navigation" }),
  ).toHaveCount(0);
  await omitted.context.close();

  // The operator's cookies carried by someone else's Access identity.
  const switched = await visit({
    "Cf-Access-Jwt-Assertion": accessAssertion(memberEmail),
  });
  await expect(
    switched.page.getByRole("navigation", { name: "Admin navigation" }),
  ).toHaveCount(0);
  await switched.context.close();

  // The operator's cookies with the operator's identity still work.
  const genuine = await visit({
    "Cf-Access-Jwt-Assertion": accessAssertion(operatorEmail),
  });
  await expect(
    genuine.page.getByRole("heading", { name: "Reports", exact: true }),
  ).toBeVisible();
  await genuine.context.close();
});

// SESSION-01, SESSION-09
test("SESSION-01/09: the admin cookies are host-only, strict, and leave the public cookie alone", async ({
  browser,
  request,
}) => {
  const exchange = await request.post(`${apiURL}/admin/v1/auth/exchange`, {
    headers: {
      ...proxyHeaders,
      Origin: adminOrigin,
      "Cf-Access-Jwt-Assertion": accessAssertion(operatorEmail),
    },
  });
  const cookies = setCookies(exchange).map((cookie) =>
    cookie.split(";").map((part) => part.trim()),
  );
  expect(cookies.map(([pair]) => pair.split("=")[0])).toEqual([
    "cgn_admin_session",
    "cgn_admin_csrf",
  ]);
  for (const [pair, ...attributes] of cookies) {
    const lowered = attributes.map((attribute) => attribute.toLowerCase());
    expect(lowered, `${pair.split("=")[0]} attributes`).toContain(
      "samesite=strict",
    );
    expect(lowered).toContain("path=/");
    expect(lowered.some((attribute) => attribute.startsWith("domain="))).toBe(
      false,
    );
    expect(lowered.some((attribute) => attribute.startsWith("max-age="))).toBe(
      true,
    );
    // The session is unreadable to script; the CSRF token must be readable.
    expect(lowered.includes("httponly")).toBe(
      pair.startsWith("cgn_admin_session="),
    );
    // At least 256 bits of randomness, as URL-safe base64.
    expect(pair.split("=")[1]).toMatch(/^[A-Za-z0-9_-]{43,}$/);
  }

  // Through the console: the public cookie survives, and no admin cookie is
  // offered to another host.
  const context = await browser.newContext({
    extraHTTPHeaders: {
      "Cf-Access-Jwt-Assertion": accessAssertion(operatorEmail),
    },
  });
  await context.addCookies([
    {
      name: "cgn_session",
      value: "p".repeat(43),
      domain: "127.0.0.1",
      path: "/",
    },
  ]);
  const page = await context.newPage();
  await page.goto("/reports");
  await expect(
    page.getByRole("heading", { name: "Reports", exact: true }),
  ).toBeVisible();

  const here = await context.cookies(adminOrigin);
  expect(here.find((cookie) => cookie.name === "cgn_session")?.value).toBe(
    "p".repeat(43),
  );
  expect(new Set(here.map((cookie) => cookie.name))).toEqual(
    new Set(["cgn_admin_csrf", "cgn_admin_session", "cgn_session"]),
  );
  const otherHosts = [
    "http://localhost:3310",
    "http://127.0.0.2:3310",
    "http://admin.localhost:3310",
    "http://sibling.127.0.0.1.nip.io:3310",
  ];
  const offered = await Promise.all(
    otherHosts.map((other) => context.cookies(other)),
  );
  expect(offered).toEqual(otherHosts.map(() => []));
  await context.close();
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
    .filter({ has: page.locator(`a[href="/users/${revokedAdmin.id}"]`) });
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

// CSRF-02, CSRF-04, CSRF-05
test("CSRF-02/04/05: cross-origin and originless posts to a console action are refused", async ({
  context,
  page,
  request,
}) => {
  const gameID = "20000000-0000-4000-8000-000000000001";
  await signInThroughAccess(context, operatorEmail);
  await page.goto(`/games/${gameID}`);
  const action = await panel(page, "Edit game")
    .locator("form")
    .first()
    .getAttribute("action");
  expect(action).toMatch(/^\/_serverFn\//);

  const operator = await exchangeSession(request, operatorEmail);
  const gameURL = `${apiURL}/admin/v1/games/${gameID}`;
  const before = await (
    await request.get(gameURL, { headers: operator.readHeaders })
  ).json();

  const cookie = (await context.cookies())
    .map(({ name, value }) => `${name}=${value}`)
    .join("; ");
  const target = `${adminOrigin}${action}`;
  const bodies: { type: string; data: string }[] = [
    {
      type: "application/x-www-form-urlencoded",
      data: "name=CSRF-HIT&reason=forged",
    },
    { type: "text/plain", data: "name=CSRF-HIT&reason=forged" },
    {
      type: "application/json",
      data: JSON.stringify({ name: "CSRF-HIT", reason: "forged" }),
    },
    {
      type: "multipart/form-data; boundary=x",
      data: '--x\r\nContent-Disposition: form-data; name="name"\r\n\r\nCSRF-HIT\r\n--x--\r\n',
    },
  ];
  const origins: (string | undefined)[] = [
    "https://evil.example",
    `${adminOrigin}.evil.test`,
    `${adminOrigin}@evil.test`,
    "http://127.0.0.1:3311",
    "null",
    undefined,
  ];
  const attempts = bodies.flatMap(({ type, data }) =>
    origins.map((origin) => ({ type, data, origin })),
  );
  const statuses = await Promise.all(
    attempts.map(async ({ type, data, origin }) =>
      (
        await request.post(target, {
          headers: {
            Cookie: cookie,
            "Cf-Access-Jwt-Assertion": accessAssertion(operatorEmail),
            "Content-Type": type,
            ...(origin === undefined ? {} : { Origin: origin }),
          },
          data,
          maxRedirects: 0,
        })
      ).status(),
    ),
  );
  expect(statuses).toEqual(attempts.map(() => 403));

  // A forged Host or forwarded host cannot make an attacker origin match.
  const forgedHost = await request.post(target, {
    headers: {
      Cookie: cookie,
      "Cf-Access-Jwt-Assertion": accessAssertion(operatorEmail),
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: "https://evil.example",
      "X-Forwarded-Host": "evil.example",
      Forwarded: "host=evil.example",
    },
    data: "name=CSRF-HIT&reason=forged",
    maxRedirects: 0,
  });
  expect(forgedHost.status()).toBe(403);

  // The same request from the console's own origin reaches the action.
  const sameOrigin = await request.post(target, {
    headers: {
      Cookie: cookie,
      "Cf-Access-Jwt-Assertion": accessAssertion(operatorEmail),
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: adminOrigin,
    },
    data: "",
    maxRedirects: 0,
  });
  expect(sameOrigin.status()).not.toBe(403);

  const after = await (
    await request.get(gameURL, { headers: operator.readHeaders })
  ).json();
  expect(after).toEqual(before);
});

// HEADER-01 to HEADER-07, XSS-05
test("HEADER: every kind of response is private, non-indexable, and hardened", async ({
  request,
}) => {
  const asOperator = {
    "Cf-Access-Jwt-Assertion": accessAssertion(operatorEmail),
  };
  const responses: {
    kind: string;
    response: Awaited<ReturnType<typeof request.get>>;
    html?: boolean;
  }[] = [
    {
      kind: "an authenticated page",
      response: await request.get("/reports", { headers: asOperator }),
      html: true,
    },
    {
      kind: "a record page",
      response: await request.get(`/reports/${reportID}`, {
        headers: asOperator,
      }),
      html: true,
    },
    {
      kind: "a page that does not exist",
      response: await request.get("/no-such-page", { headers: asOperator }),
      html: true,
    },
    { kind: "a refused request", response: await request.get("/reports") },
    { kind: "the health check", response: await request.get("/api/health") },
    {
      kind: "a redirect",
      response: await request.post("/step-up", {
        headers: { ...asOperator, origin: adminOrigin },
        form: { return: "/" },
        maxRedirects: 0,
      }),
    },
  ];
  // A built asset is served by the static handler, not the app.
  const page = await request.get("/reports", { headers: asOperator });
  const asset = /\/assets\/[^"']+\.js/.exec(await page.text())?.[0];
  expect(asset, "the page links a script asset").toBeTruthy();
  responses.push({
    kind: "a built asset",
    response: await request.get(asset ?? ""),
  });

  for (const { kind, response, html } of responses) {
    const headers = response.headers();
    expect(headers["cache-control"], `${kind}: cache-control`).toBe(
      "private, no-store",
    );
    expect(headers["x-robots-tag"], `${kind}: x-robots-tag`).toContain(
      "noindex, nofollow, noarchive",
    );
    expect(headers["x-content-type-options"], `${kind}: nosniff`).toBe(
      "nosniff",
    );
    expect(headers["referrer-policy"], `${kind}: referrer-policy`).toBe(
      "no-referrer",
    );
    // Local HTTP never claims an HSTS policy it cannot honor.
    expect(
      headers["strict-transport-security"],
      `${kind}: hsts`,
    ).toBeUndefined();
    if (kind !== "a built asset") {
      expect(headers["x-frame-options"], `${kind}: x-frame-options`).toBe(
        "DENY",
      );
      expect(headers["content-security-policy"], `${kind}: csp`).toContain(
        "frame-ancestors 'none'",
      );
    }
    if (html) {
      expect(headers["vary"], `${kind}: vary`).toContain("Cookie");
      expect(
        headers["permissions-policy"],
        `${kind}: permissions-policy`,
      ).toContain("camera=()");
    }
  }

  // The policy itself: nothing broad, no eval, inline script only by nonce.
  const policy = responses[0].response.headers()["content-security-policy"];
  for (const directive of [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "connect-src 'self'",
    "font-src 'self'",
  ]) {
    expect(policy).toContain(directive);
  }
  expect(policy).not.toContain("unsafe-eval");
  expect(policy).not.toMatch(/script-src[^;]*unsafe-inline/);
  expect(policy).not.toMatch(/(default|script|connect|img)-src[^;]*\*/);
  expect(policy).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]{22,}'/);

  // The robots meta tag is on every HTML page.
  expect(await responses[0].response.text()).toMatch(
    /<meta[^>]+name="robots"[^>]+content="noindex,nofollow,noarchive/,
  );
});

// HEADER-06: failures say what went wrong in stable public terms only.
test("HEADER-06: error responses carry no stack, SQL, internal address, or secret", async ({
  request,
}) => {
  const asOperator = {
    ...proxyHeaders,
    "X-CGN-Admin-Access-Email": operatorEmail,
  };
  const session = await exchangeSession(request, operatorEmail);
  const consoleResponses = await Promise.all(
    [
      "/no-such-page",
      "/reports/not-a-uuid",
      "/reports/00000000-0000-4000-8000-0000000000ff",
      "/users/00000000-0000-4000-8000-0000000000ff",
      "/schools/%00",
      "/games/%27%20OR%201%3D1--",
    ].map((path) =>
      request.get(path, {
        headers: { "Cf-Access-Jwt-Assertion": accessAssertion(bystanderEmail) },
      }),
    ),
  );
  const apiResponses = await Promise.all([
    request.get(`${apiURL}/admin/v1/reports/not-a-uuid`, {
      headers: session.readHeaders,
    }),
    request.get(
      `${apiURL}/admin/v1/reports?limit=abc&state=%27%3B%20DROP%20TABLE%20users--`,
      { headers: session.readHeaders },
    ),
    request.patch(`${apiURL}/admin/v1/reports/${reportID}`, {
      headers: {
        ...session.mutationHeaders,
        "Content-Type": "application/json",
      },
      data: "{",
    }),
    request.get(`${apiURL}/admin/v1/users?cursor=not-a-cursor`, {
      headers: session.readHeaders,
    }),
    request.get(`${apiURL}/admin/v1/nonexistent`, { headers: asOperator }),
  ]);
  const leaks = [
    /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|fetch failed/i,
    /127\.0\.0\.1:18090|localhost:8080/,
    /SQLSTATE|pgx|pq:|syntax error at|relation ".*" does not exist|duplicate key/i,
    /\bat\s+\S+\s+\(.*:\d+:\d+\)/,
    /goroutine|panic:|stack trace/i,
    new RegExp(adminProxySecret),
    /node_modules|\.output\/server/,
  ];
  const everything = [...consoleResponses, ...apiResponses];
  const bodies = await Promise.all(
    everything.map((response) => response.text()),
  );
  for (const [index, response] of everything.entries()) {
    for (const leak of leaks) {
      expect(
        bodies[index],
        `${response.url()} (${response.status()}) leaked ${leak}`,
      ).not.toMatch(leak);
    }
  }
  // The Admin API answers with a stable code and nothing else.
  for (const body of bodies.slice(consoleResponses.length).slice(0, 4)) {
    expect(Object.keys(JSON.parse(body))).toEqual(["error"]);
  }
});

test("XSS-05: only scripts carrying this request's nonce may run", async ({
  context,
  page,
  request,
}) => {
  const asOperator = {
    "Cf-Access-Jwt-Assertion": accessAssertion(operatorEmail),
  };
  const noncesOf = async () => {
    const response = await request.get("/reports", { headers: asOperator });
    const nonce = /script-src 'self' 'nonce-([^']+)'/.exec(
      response.headers()["content-security-policy"],
    )?.[1];
    const html = await response.text();
    const inline = [...html.matchAll(/<script(?![^>]*\ssrc=)([^>]*)>/g)].map(
      (match) => /nonce="([^"]+)"/.exec(match[1])?.[1],
    );
    return { nonce, inline };
  };

  const first = await noncesOf();
  const second = await noncesOf();
  expect(first.nonce).toBeTruthy();
  expect(first.nonce).not.toBe(second.nonce);
  // Every inline script the framework renders carries the response's nonce.
  expect(first.inline.length).toBeGreaterThan(0);
  expect(first.inline.every((nonce) => nonce === first.nonce)).toBe(true);

  // A hydrated page runs under the policy without a single violation...
  const violations: string[] = [];
  page.on("console", (message) => {
    if (/content security policy/i.test(message.text()))
      violations.push(message.text());
  });
  await signInThroughAccess(context, bystanderEmail);
  await page.goto("/reports");
  await expect(
    page.getByRole("heading", { name: "Reports", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Support tickets" }).click();
  await expect(
    page.getByRole("heading", { name: "Support tickets", exact: true }),
  ).toBeVisible();
  expect(violations).toEqual([]);

  // ...and markup injected into it cannot execute.
  const executed = await page.evaluate(() => {
    const injected = document.createElement("script");
    injected.textContent = "globalThis.injectedScriptRan = true";
    document.body.append(injected);
    const handler = document.createElement("img");
    handler.setAttribute("src", "x");
    handler.setAttribute("onerror", "globalThis.injectedScriptRan = true");
    document.body.append(handler);
    return new Promise((resolve) =>
      setTimeout(
        () =>
          resolve(
            Boolean(
              (globalThis as { injectedScriptRan?: boolean }).injectedScriptRan,
            ),
          ),
        300,
      ),
    );
  });
  expect(executed).toBe(false);
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
