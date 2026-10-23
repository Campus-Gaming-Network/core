import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vite-plus/test";
import { establishPrivateAuthPage } from "../src/features/auth-flow-slice/auth-flow.functions.js";
import { Route as ResetRoute } from "../src/routes/reset-password.js";
import { Route as VerifyRoute } from "../src/routes/auth.verify-email.js";
import { loadRoute } from "./route-test.js";

vi.mock("../src/features/auth-flow-slice/auth-flow.functions.js", () => ({
  establishPrivateAuthPage: vi.fn(),
  resetPassword: { url: "/test/reset-password" },
  verifyEmail: { url: "/test/verify-email" },
  signup: { url: "/test/signup" },
  forgotPassword: { url: "/test/forgot-password" },
  resendVerification: { url: "/test/resend-verification" },
}));
beforeEach(() => vi.clearAllMocks());

for (const [route, path, action] of [
  [ResetRoute, "/reset-password", "/test/reset-password"],
  [VerifyRoute, "/auth/verify-email", "/test/verify-email"],
] as const) {
  test(`${path} renders a token only as a hidden form value and establishes private response headers`, async () => {
    const token = "secret-token-must-not-be-visible";
    const { match, render } = await loadRoute(
      route,
      path,
      `${path}?token=${token}`,
    );
    assert.deepEqual(match?.headers, {
      "cache-control": "private, no-store",
      "referrer-policy": "no-referrer",
    });
    assert.equal(vi.mocked(establishPrivateAuthPage).mock.calls.length, 1);
    assert.equal(JSON.stringify(match?.meta).includes(token), false);
    const markup = render();
    assert.match(
      markup,
      new RegExp(`<form[^>]*action="${action}"[^>]*method="post"`),
    );
    assert.match(
      markup,
      new RegExp(
        `<input[^>]*type="hidden"[^>]*name="token"[^>]*value="${token}"`,
      ),
    );
    assert.equal(markup.replace(/<[^>]*>/g, "").includes(token), false);
    assert.equal((markup.match(new RegExp(token, "g")) ?? []).length, 1);
  });

  test(`${path} gives a recovery path when the token is missing`, async () => {
    const { render } = await loadRoute(route, path);
    const markup = render();
    assert.doesNotMatch(markup, /name="token"/);
    assert.match(
      markup,
      path === "/reset-password"
        ? /href="\/forgot-password"/
        : /action="\/test\/resend-verification"/,
    );
  });
}
