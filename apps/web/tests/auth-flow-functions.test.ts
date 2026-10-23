import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vite-plus/test";
import {
  establishPrivateAuthPage,
  resetPassword,
  verifyEmail,
} from "../src/features/auth-flow-slice/auth-flow.functions.js";
import {
  resetPasswordOperation,
  verifyEmailOperation,
} from "../src/features/auth-flow-slice/auth-flow-operations.server.js";
import {
  isNativeFormPost,
  setPrivateNoStoreResponse,
} from "../src/server/request-boundary.server.js";
import { isRedirect } from "@tanstack/react-router";

vi.mock("@tanstack/react-start", async () => {
  const { serverFunctionBuilder } = await import("./server-function-test.js");
  return {
    createServerFn: () => serverFunctionBuilder((input: undefined) => input),
  };
});
vi.mock("@tanstack/react-start/server", () => ({ getCookie: vi.fn() }));
vi.mock("../src/server/request-boundary.server.js", () => ({
  applyCookieMutation: vi.fn(),
  goBFFForCurrentRequest: vi.fn(),
  isNativeFormPost: vi.fn(),
  sendGoalForCurrentRequest: vi.fn(),
  setPrivateNoStoreResponse: vi.fn(),
}));
vi.mock(
  "../src/features/auth-flow-slice/auth-flow-operations.server.js",
  () => ({
    currentPoliciesOperation: vi.fn(),
    forgotPasswordOperation: vi.fn(),
    resendVerificationOperation: vi.fn(),
    resetPasswordOperation: vi.fn(),
    signupOperation: vi.fn(),
    verifyEmailOperation: vi.fn(),
  }),
);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isNativeFormPost).mockReturnValue(true);
});

const tokenSubmissions = [
  {
    name: "password reset",
    submit: (valid = true) => {
      const data = new FormData();
      data.set("token", valid ? "secret-token" : "");
      data.set("password", valid ? "CorrectHorseBattery1!" : "");
      return resetPassword({ data });
    },
    successHref: "/login?reset=complete",
    failureHref: "/reset-password?reset=failed",
  },
  {
    name: "email verification",
    submit: (valid = true) => {
      const data = new FormData();
      data.set("token", valid ? "secret-token" : "");
      return verifyEmail({ data });
    },
    successHref: "/auth/verify-email?verified=complete",
    failureHref: "/auth/verify-email?error=invalid-link",
  },
];

for (const { name, submit, successHref, failureHref } of tokenSubmissions) {
  for (const success of [true, false]) {
    test(`native ${name} redirects without the token (success=${success})`, async () => {
      vi.mocked(resetPasswordOperation).mockResolvedValue(
        success
          ? {
              status: "success",
              message: "Password reset.",
              redirectTo: "/login?reset=complete",
            }
          : { status: "error", message: "Invalid link." },
      );
      vi.mocked(verifyEmailOperation).mockResolvedValue(
        success
          ? {
              status: "success",
              message: "Email verified.",
              redirectTo: "/auth/verify-email?verified=complete",
            }
          : { status: "error", message: "Invalid link." },
      );
      await assert.rejects(
        async () => submit(),
        (error: unknown) => {
          assert.ok(isRedirect(error));
          assert.deepEqual(
            { href: error.options.href, status: error.status },
            { href: success ? successHref : failureHref, status: 303 },
          );
          return true;
        },
      );
      assert.equal(vi.mocked(setPrivateNoStoreResponse).mock.calls.length, 1);
    });
  }

  test(`invalid native ${name} redirects to recovery without calling the API`, async () => {
    await assert.rejects(
      async () => submit(false),
      (error: unknown) => {
        assert.ok(isRedirect(error));
        assert.deepEqual(
          { href: error.options.href, status: error.status },
          { href: failureHref, status: 303 },
        );
        return true;
      },
    );
    assert.deepEqual(
      [
        vi.mocked(resetPasswordOperation).mock.calls,
        vi.mocked(verifyEmailOperation).mock.calls,
      ],
      [[], []],
    );
  });
}

test("private auth-page loading tightens the response cache policy", async () => {
  assert.deepEqual(await establishPrivateAuthPage(), { private: true });
  assert.equal(vi.mocked(setPrivateNoStoreResponse).mock.calls.length, 1);
});
