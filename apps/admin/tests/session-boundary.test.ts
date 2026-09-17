import assert from "node:assert/strict";
import test from "node:test";
import type { ApiClient } from "../src/server/api.server.js";
import type { CookieMutation } from "../src/server/cookies.server.js";
import type { AdminSession } from "../src/server/contracts.server.js";
import {
  establishAdminSession,
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

test("an existing admin session is authorized before protected SSR renders", async () => {
  let assertionChecks = 0;
  const api = (async ({ path }) => {
    assert.equal(path, "/admin/v1/session");
    return { data: session, response: Response.json(session) };
  }) as ApiClient;

  const result = await establishAdminSession({
    api,
    siteOrigin: "https://admin.example.test",
    assertion: "unused",
    sessionCookieName: "admin_session",
    sessionCookieValue: "opaque-session",
    csrfCookieName: "admin_csrf",
    strictDeployment: true,
    validateAssertion: async () => {
      assertionChecks += 1;
    },
    applyCookies: () => undefined,
  });

  assert.equal(result.status, "authenticated");
  assert.equal(assertionChecks, 0);
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
  const api = (async ({ path, cookieHeader, headers: requestHeaders }) => {
    assert.equal(path, "/admin/v1/auth/step-up");
    assert.equal(cookieHeader, "admin_session=opaque; admin_csrf=csrf");
    const outgoing = new Headers(requestHeaders);
    assert.equal(outgoing.get("Origin"), "https://admin.example.test");
    assert.equal(outgoing.get("X-CGN-Admin-CSRF"), "csrf");
    assert.equal(outgoing.get("Cf-Access-Jwt-Assertion"), "fresh-access-token");
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
    validateAssertion: async () => undefined,
    applyCookies: () => undefined,
  });

  assert.equal(result.status, "unauthorized");
  assert.equal(apiCalls, 0);
});
