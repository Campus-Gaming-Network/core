import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { loginProblem } from "../src/features/auth-flow-slice/login-help.js";

test("loginProblem sorts the login messages the web shows", () => {
  assert.deepEqual(
    [
      "Your account is suspended.",
      "Please verify your email before logging in.",
      "Too many attempts. Please try again later.",
      "The email or password did not match.",
      "We could not log you in. Check your details and try again.",
      "Something went wrong. Please try again.",
      "",
    ].map(loginProblem),
    [
      "suspended",
      "unverified",
      "rate-limited",
      "mismatch",
      "mismatch",
      undefined,
      undefined,
    ],
  );
});
