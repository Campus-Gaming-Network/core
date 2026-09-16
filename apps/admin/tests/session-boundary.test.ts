import assert from "node:assert/strict";
import test from "node:test";
import type { ApiClient } from "../src/server/api.server.js";
import type { CookieMutation } from "../src/server/cookies.server.js";
import type { AdminSession } from "../src/server/contracts.server.js";
import { establishAdminSession } from "../src/server/session.server.js";

const session: AdminSession = {
  user_id: "11111111-1111-4111-8111-111111111111",
  email: "admin@example.test",
  role: "site_admin",
  capabilities: ["admin.session.read"],
  authenticated_at: "2026-09-16T12:00:00Z",
  absolute_expires_at: "2026-09-16T20:00:00Z"
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
    validateAssertion: async () => { assertionChecks += 1; },
    applyCookies: () => undefined
  });

  assert.equal(result.status, "authenticated");
  assert.equal(assertionChecks, 0);
});

test("exchange validates Access and requires both hardened cookies", async () => {
  const headers = new Headers();
  headers.append(
    "set-cookie",
    "admin_session=opaque; Path=/; Secure; HttpOnly; SameSite=Strict"
  );
  headers.append(
    "set-cookie",
    "admin_csrf=csrf; Path=/; Secure; SameSite=Strict"
  );
  let checkedAssertion = "";
  let mutations: CookieMutation[] = [];
  const api = (async ({ path }) => {
    assert.equal(path, "/admin/v1/auth/exchange");
    return { data: session, response: new Response(JSON.stringify(session), { headers }) };
  }) as ApiClient;

  const result = await establishAdminSession({
    api,
    siteOrigin: "https://admin.example.test",
    assertion: "signed-access-token",
    sessionCookieName: "admin_session",
    csrfCookieName: "admin_csrf",
    strictDeployment: true,
    validateAssertion: async (assertion) => { checkedAssertion = assertion; },
    applyCookies: (value) => { mutations = value; }
  });

  assert.equal(result.status, "authenticated");
  assert.equal(checkedAssertion, "signed-access-token");
  assert.equal(mutations.length, 2);
});
