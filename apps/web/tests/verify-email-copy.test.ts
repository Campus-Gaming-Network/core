import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { validateVerifyEmailSearch } from "../src/features/auth-flow-slice/contracts.js";
import {
  resendVerificationMessage,
  verifyEmailCopy,
} from "../src/features/auth-flow-slice/presentation.js";

test("the page a no-JavaScript resend lands on says the email was sent, not that the link failed", () => {
  // The resend form posts without JavaScript and redirects here, with no token.
  const search = validateVerifyEmailSearch({ resend: "sent" });

  assert.deepEqual(verifyEmailCopy(search), {
    heading: "Send a new verification email",
    message: {
      role: "lede",
      text: "Enter the email you signed up with and we will send another verification link.",
    },
  });
  assert.equal(
    resendVerificationMessage(search.resend),
    "If that account needs verification, another email is on the way.",
  );
});

test("a broken verification link still reports the failure", () => {
  assert.deepEqual(
    verifyEmailCopy(validateVerifyEmailSearch({ error: "invalid-link" })),
    {
      heading: "We could not verify that link",
      message: {
        role: "alert",
        text: "That link is invalid or has expired. Enter your email to get a new one.",
      },
    },
  );
});
