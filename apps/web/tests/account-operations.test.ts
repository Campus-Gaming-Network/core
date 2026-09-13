import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, type ApiClient } from "../src/server/api.server.js";
import {
  accountDashboardOperation,
  deleteAccountOperation,
  updateProfileOperation
} from "../src/features/account-slice/account-operations.server.js";
import {
  accountProfileDtoSchema,
  validateDeleteAccountInput,
  validateUpdateProfileInput
} from "../src/features/account-slice/contracts.js";

const profile = {
  id: "user-1",
  email: "player@example.test",
  email_verified_at: "2037-08-01T12:00:00Z",
  verification_level: "verified_student",
  name: "Player One",
  avatar_url: "https://images.example.test/player.png",
  bio: "Captain",
  timezone: "America/Los_Angeles",
  home_school_id: "school-1",
  social_links: [{ label: "Community", url: "https://example.test/player" }],
  role_indicators: [],
  password_hash: "must-strip",
  session: "must-strip"
};

test("account dashboard requires /me, strips private additions, and isolates secondary failures", async () => {
  const calls: Array<{ path: string; cookie?: string }> = [];
  const api = (async ({ path, cookieHeader }) => {
    calls.push({ path, cookie: cookieHeader });
    if (path === "/me") return result(accountProfileDtoSchema.parse(profile));
    if (path === "/me/events?limit=5") throw new Error("event outage");
    if (path === "/me/schools") return result({ schools: [] });
    if (path === "/me/teams?limit=10") return result({ teams: [], limit: 10 });
    throw new Error(`Unexpected path ${path}`);
  }) as ApiClient;

  const dashboard = await accountDashboardOperation({
    api,
    cookieHeader: "cgn_session=secret",
    reportError: () => undefined
  });
  assert.equal(dashboard.status, "found");
  if (dashboard.status !== "found") return;
  assert.equal("password_hash" in dashboard.profile, false);
  assert.equal("session" in dashboard.profile, false);
  assert.deepEqual(dashboard.dashboardEvents, {
    upcoming_rsvps: [],
    followed_school_events: []
  });
  assert.equal(dashboard.unavailable.dashboardEvents, true);
  assert.equal(dashboard.unavailable.followedSchools, false);
  assert.equal(dashboard.unavailable.teams, false);
  assert.ok(calls.every((call) => call.cookie === "cgn_session=secret"));
});

test("account dashboard distinguishes 401 from an upstream outage", async () => {
  const unauthorized = (async () => {
    throw new ApiError(401, "authentication_required");
  }) as ApiClient;
  assert.deepEqual(
    await accountDashboardOperation({ api: unauthorized, cookieHeader: "cgn_session=old" }),
    { status: "unauthenticated" }
  );

  const unavailable = (async () => {
    throw new ApiError(503, "database_unavailable");
  }) as ApiClient;
  assert.deepEqual(
    await accountDashboardOperation({
      api: unavailable,
      cookieHeader: "cgn_session=live",
      reportError: () => undefined
    }),
    { status: "error", message: "Account details are unavailable." }
  );
});

test("profile and deletion validation support typed and native inputs", () => {
  const form = new FormData();
  form.set("name", " Player One ");
  form.set("bio", " Bio ");
  form.set("timezone", "America/Los_Angeles");
  form.set("social_label_0", "Community");
  form.set("social_url_0", "https://example.test/player");
  const update = validateUpdateProfileInput(form);
  assert.equal(update.valid, true);
  if (update.valid) assert.equal(update.value.name, "Player One");

  const invalidURL = validateUpdateProfileInput({
    name: "Player",
    bio: "",
    timezone: "America/Los_Angeles",
    social_links: [{ label: "Unsafe", url: "javascript:alert(1)" }]
  });
  assert.equal(invalidURL.valid, false);
  if (!invalidURL.valid) assert.ok(invalidURL.fieldErrors.social_url_0);

  const confirm = new FormData();
  confirm.set("confirm", " delete ");
  assert.equal(validateDeleteAccountInput(confirm).valid, true);
  assert.equal(validateDeleteAccountInput({ confirm: "remove" }).valid, false);
});

test("profile update sends only validated fields and deletion drops the local root cookie", async () => {
  const requests: unknown[] = [];
  const api = (async (options) => {
    requests.push(options);
    if (options.method === "DELETE") return result(undefined);
    return result(profile);
  }) as ApiClient;

  const update = await updateProfileOperation(
    {
      name: "Player One",
      bio: "Captain",
      timezone: "America/Los_Angeles",
      social_links: []
    },
    { api, cookieHeader: "cgn_session=secret" }
  );
  assert.equal(update.status, "success");

  const cookies: unknown[] = [];
  const deletion = await deleteAccountOperation(
    { confirm: "DELETE" },
    {
      api,
      cookieHeader: "cgn_session=secret",
      sessionCookieName: "cgn_session",
      applyCookie: (cookie) => cookies.push(cookie)
    }
  );
  assert.deepEqual(deletion, {
    status: "success",
    message: "Account deleted.",
    redirectTo: "/?account=deleted"
  });
  assert.deepEqual(cookies, [
    { kind: "delete", name: "cgn_session", options: { path: "/" } }
  ]);
  assert.deepEqual(
    requests.map((request) => (request as { method?: string }).method),
    ["PATCH", "DELETE"]
  );
});

function result<T>(data: T) {
  return { data, response: new Response(null, { status: data === undefined ? 204 : 200 }) };
}
