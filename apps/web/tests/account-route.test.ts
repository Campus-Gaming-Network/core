import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vite-plus/test";
import { getAccountDashboard } from "../src/features/account-slice/account.functions.js";
import { Route } from "../src/routes/account.js";
import { loadRoute } from "./route-test.js";
import { routeAccount } from "./route-fixtures.js";

vi.mock("../src/features/account-slice/account.functions.js", () => ({
  getAccountDashboard: vi.fn(),
}));
beforeEach(() => vi.clearAllMocks());

test("account loader redirects a signed-out viewer to login with a return path", async () => {
  vi.mocked(getAccountDashboard).mockResolvedValue({
    status: "unauthenticated",
  });
  const { response } = await loadRoute(Route, "/account");
  assert.equal(response?.type, "redirect");
  assert.equal(
    response?.type === "redirect" && response.redirect.headers.get("location"),
    "/login?next=%2Faccount",
  );
});

test("account renders profile, event and team links with private, noindex metadata", async () => {
  vi.mocked(getAccountDashboard).mockResolvedValue(routeAccount);
  const { match, render } = await loadRoute(Route, "/account");
  assert.deepEqual(match?.headers, {
    "cache-control": "private, no-store",
    vary: "Cookie",
  });
  assert.ok(Array.isArray(match?.meta));
  assert.ok(
    match.meta.some(
      (tag) => tag?.name === "robots" && tag.content === "noindex,nofollow",
    ),
  );
  const markup = render();
  assert.match(markup, /href="\/users\/public-user"/);
  assert.match(markup, /href="\/events\/campus-night"/);
  assert.match(markup, /href="\/teams\/campus-team"/);
  assert.match(markup, /Campus Player/);
});

test("an account outage fails the page instead of treating the viewer as signed out", async () => {
  vi.mocked(getAccountDashboard).mockResolvedValue({
    status: "error",
    message: "Account details are unavailable.",
  });
  const { response } = await loadRoute(Route, "/account");
  assert.equal(response?.type === "render" && response.status, 500);
});
