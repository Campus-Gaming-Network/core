import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vite-plus/test";
import { getPublicProfilePage } from "../src/features/public-profile/public-profile.functions.js";
import { Route } from "../src/routes/users.$id.js";
import { loadRoute } from "./route-test.js";
import { routeProfile } from "./route-fixtures.js";

vi.mock("../src/features/public-profile/public-profile.functions.js", () => ({
  getPublicProfilePage: vi.fn(),
  reportUser: { url: "/test/report-user" },
}));
beforeEach(() => vi.clearAllMocks());

test("a missing public profile produces a 404", async () => {
  vi.mocked(getPublicProfilePage).mockResolvedValue({
    status: "not_found",
    hasSessionCookie: false,
  });
  const { response } = await loadRoute(Route, "/users/$id", "/users/missing");
  assert.equal(response?.type === "render" && response.status, 404);
});

for (const hasSessionCookie of [false, true]) {
  test(`profile headers follow the session cookie (${hasSessionCookie})`, async () => {
    vi.mocked(getPublicProfilePage).mockResolvedValue({
      status: "found",
      profile: routeProfile,
      viewer: hasSessionCookie ? "self" : "anonymous",
      hasSessionCookie,
    });
    const { match, render } = await loadRoute(
      Route,
      "/users/$id",
      "/users/public-user",
    );
    assert.deepEqual(match?.headers, {
      "cache-control": hasSessionCookie
        ? "private, no-store"
        : "public, max-age=0, must-revalidate",
      vary: "Cookie",
    });
    const markup = render();
    assert.match(markup, /Campus Player/);
    assert.match(markup, /Looking for games\./);
    assert.ok(Array.isArray(match?.meta));
    assert.ok(
      match.meta.some(
        (tag) => tag?.name === "robots" && tag.content === "noindex,nofollow",
      ),
    );
    assert.equal(markup.includes('href="/settings/profile"'), hasSessionCookie);
  });
}

test("a profile outage is an error rather than a missing profile", async () => {
  vi.mocked(getPublicProfilePage).mockResolvedValue({
    status: "error",
    message: "We could not load this profile. Please try again.",
    hasSessionCookie: false,
  });
  const { response } = await loadRoute(
    Route,
    "/users/$id",
    "/users/public-user",
  );
  assert.equal(response?.type === "render" && response.status, 500);
});
