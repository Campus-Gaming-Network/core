import assert from "node:assert/strict";
import test from "node:test";
import { AccessAssertionError } from "../src/server/access-assertion.server.js";
import { AdminApiError, type ApiClient } from "../src/server/api.server.js";
import type { CookieMutation } from "../src/server/cookies.server.js";
import type { AdminSession } from "../src/server/contracts.server.js";
import {
  establishAdminSession,
  logoutAdminSession,
  stepUpAdminSession,
} from "../src/server/session.server.js";

const session: AdminSession = {
  user_id: "11111111-1111-4111-8111-111111111111",
  email: "admin@example.test",
  role: "site_admin",
  capabilities: ["admin.session.read"],
  authenticated_at: "2026-09-16T12:00:00Z",
  absolute_expires_at: "2026-09-16T20:00:00Z",
};

const identity = { email: "admin@example.test", subject: "access-subject" };

test("an existing admin session is authorized only with a verified identity on the request", async () => {
  const assertionsChecked: string[] = [];
  const identitiesSent: (string | undefined)[] = [];
  const api = (async ({ path, accessEmail }) => {
    assert.equal(path, "/admin/v1/session");
    identitiesSent.push(accessEmail);
    return { data: session, response: Response.json(session) };
  }) as ApiClient;

  const result = await establishAdminSession({
    api,
    siteOrigin: "https://admin.example.test",
    assertion: "signed-access-token",
    sessionCookieName: "admin_session",
    sessionCookieValue: "opaque-session",
    csrfCookieName: "admin_csrf",
    strictDeployment: true,
    validateAssertion: async (assertion) => {
      assertionsChecked.push(assertion);
      return identity;
    },
    applyCookies: () => undefined,
  });

  assert.equal(result.status, "authenticated");
  assert.deepEqual(assertionsChecked, ["signed-access-token"]);
  assert.deepEqual(identitiesSent, [identity.email]);
});

test("a session cookie without a valid Access assertion never reaches the API", async () => {
  await Promise.all(
    (
      [
        ["missing", "unauthorized"],
        ["invalid", "unauthorized"],
        ["unavailable", "unavailable"],
      ] as const
    ).map(async ([reason, status]) => {
      let apiCalls = 0;
      const result = await establishAdminSession({
        api: (async () => {
          apiCalls += 1;
          throw new Error("unexpected API call");
        }) as ApiClient,
        siteOrigin: "https://admin.example.test",
        assertion: "",
        sessionCookieName: "admin_session",
        sessionCookieValue: "opaque-session",
        csrfCookieName: "admin_csrf",
        strictDeployment: true,
        validateAssertion: async () => {
          throw new AccessAssertionError(reason);
        },
        applyCookies: () => undefined,
        reportError: () => undefined,
      });

      assert.equal(result.status, status, reason);
      assert.equal(apiCalls, 0, reason);
    }),
  );
});

test("a session bound to another identity is replaced by an exchange for the verified one", async () => {
  const calls: { path: string; accessEmail?: string }[] = [];
  const headers = new Headers();
  headers.append(
    "set-cookie",
    "admin_session=fresh; Path=/; Secure; HttpOnly; SameSite=Strict",
  );
  headers.append(
    "set-cookie",
    "admin_csrf=fresh-csrf; Path=/; Secure; SameSite=Strict",
  );
  const api = (async ({ path, accessEmail }) => {
    calls.push({ path, accessEmail });
    if (path === "/admin/v1/session")
      throw new AdminApiError(401, "admin_authentication_required");
    return {
      data: session,
      response: new Response(JSON.stringify(session), { headers }),
    };
  }) as ApiClient;

  const result = await establishAdminSession({
    api,
    siteOrigin: "https://admin.example.test",
    assertion: "signed-access-token",
    sessionCookieName: "admin_session",
    sessionCookieValue: "someone-elses-session",
    csrfCookieName: "admin_csrf",
    strictDeployment: true,
    validateAssertion: async () => identity,
    applyCookies: () => undefined,
  });

  assert.equal(result.status, "authenticated");
  assert.deepEqual(calls, [
    { path: "/admin/v1/session", accessEmail: identity.email },
    { path: "/admin/v1/auth/exchange", accessEmail: undefined },
  ]);
});

test("a local console with no Access configuration still serves its stand-in API", async () => {
  const result = await establishAdminSession({
    api: (async ({ accessEmail }) => {
      assert.equal(accessEmail, undefined);
      return { data: session, response: Response.json(session) };
    }) as ApiClient,
    siteOrigin: "http://localhost:3002",
    assertion: "",
    sessionCookieName: "admin_session",
    sessionCookieValue: "opaque-session",
    csrfCookieName: "admin_csrf",
    strictDeployment: false,
    validateAssertion: async () => undefined,
    applyCookies: () => undefined,
  });

  assert.equal(result.status, "authenticated");
});

test("exchange validates Access and requires both hardened cookies", async () => {
  const headers = new Headers();
  headers.append(
    "set-cookie",
    "admin_session=opaque; Path=/; Secure; HttpOnly; SameSite=Strict",
  );
  headers.append(
    "set-cookie",
    "admin_csrf=csrf; Path=/; Secure; SameSite=Strict",
  );
  let checkedAssertion = "";
  let mutations: CookieMutation[] = [];
  const api = (async ({ path }) => {
    assert.equal(path, "/admin/v1/auth/exchange");
    return {
      data: session,
      response: new Response(JSON.stringify(session), { headers }),
    };
  }) as ApiClient;

  const result = await establishAdminSession({
    api,
    siteOrigin: "https://admin.example.test",
    assertion: "signed-access-token",
    sessionCookieName: "admin_session",
    csrfCookieName: "admin_csrf",
    strictDeployment: true,
    validateAssertion: async (assertion) => {
      checkedAssertion = assertion;
      return identity;
    },
    applyCookies: (value) => {
      mutations = value;
    },
  });

  assert.equal(result.status, "authenticated");
  assert.equal(checkedAssertion, "signed-access-token");
  assert.equal(mutations.length, 2);
});

test("step-up forwards only isolated cookies and mirrors both rotations", async () => {
  const headers = new Headers();
  headers.append(
    "set-cookie",
    "admin_session=rotated; Path=/; Secure; HttpOnly; SameSite=Strict",
  );
  headers.append(
    "set-cookie",
    "admin_csrf=rotated-csrf; Path=/; Secure; SameSite=Strict",
  );
  let mutations: CookieMutation[] = [];
  let checkedAssertion = "";
  const api = (async ({
    path,
    cookieHeader,
    headers: requestHeaders,
    accessEmail,
  }) => {
    assert.equal(path, "/admin/v1/auth/step-up");
    assert.equal(cookieHeader, "admin_session=opaque; admin_csrf=csrf");
    const outgoing = new Headers(requestHeaders);
    assert.equal(outgoing.get("Origin"), "https://admin.example.test");
    assert.equal(outgoing.get("X-CGN-Admin-CSRF"), "csrf");
    assert.equal(outgoing.get("Cf-Access-Jwt-Assertion"), "fresh-access-token");
    assert.equal(accessEmail, identity.email);
    return {
      data: { ...session, step_up_at: "2026-09-16T12:05:00Z" },
      response: new Response(JSON.stringify(session), { headers }),
    };
  }) as ApiClient;

  const result = await stepUpAdminSession({
    api,
    siteOrigin: "https://admin.example.test",
    assertion: "fresh-access-token",
    sessionCookieName: "admin_session",
    sessionCookieValue: "opaque",
    csrfCookieName: "admin_csrf",
    csrfCookieValue: "csrf",
    strictDeployment: true,
    validateAssertion: async (assertion) => {
      checkedAssertion = assertion;
      return identity;
    },
    applyCookies: (value) => {
      mutations = value;
    },
  });

  assert.equal(result.status, "authenticated");
  assert.equal(checkedAssertion, "fresh-access-token");
  assert.equal(mutations.length, 2);
});

test("step-up fails before the API without both privileged cookies", async () => {
  let apiCalls = 0;
  const result = await stepUpAdminSession({
    api: (async () => {
      apiCalls += 1;
      throw new Error("unexpected API call");
    }) as ApiClient,
    siteOrigin: "https://admin.example.test",
    assertion: "fresh-access-token",
    sessionCookieName: "admin_session",
    csrfCookieName: "admin_csrf",
    csrfCookieValue: "csrf",
    strictDeployment: true,
    validateAssertion: async () => identity,
    applyCookies: () => undefined,
  });

  assert.equal(result.status, "unauthorized");
  assert.equal(apiCalls, 0);
});

test("logout vouches for the verified identity and always clears the cookies", async () => {
  await Promise.all(
    [true, false].map(async (verified) => {
      let outgoingEmail: string | undefined;
      let apiCalls = 0;
      let mutations: CookieMutation[] = [];
      await logoutAdminSession({
        api: (async ({ accessEmail }) => {
          apiCalls += 1;
          outgoingEmail = accessEmail;
          return {
            data: undefined,
            response: new Response(null, { status: 204 }),
          };
        }) as ApiClient,
        siteOrigin: "https://admin.example.test",
        assertion: "access-token",
        sessionCookieName: "admin_session",
        sessionCookieValue: "opaque",
        csrfCookieName: "admin_csrf",
        csrfCookieValue: "csrf",
        validateAssertion: async () => {
          if (!verified) throw new AccessAssertionError("invalid");
          return identity;
        },
        applyCookies: (value) => {
          mutations = value;
        },
        reportError: () => undefined,
      });

      assert.equal(apiCalls, verified ? 1 : 0);
      assert.equal(outgoingEmail, verified ? identity.email : undefined);
      assert.deepEqual(
        mutations.map((mutation) => mutation.kind),
        ["delete", "delete"],
      );
    }),
  );
});
