import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { signupOperation } from "../src/features/auth-flow-slice/auth-flow-operations.server.js";
import { createApiClient, type Fetcher } from "../src/server/api.server.js";

const signupInput = {
  email: "new@example.test",
  password: "Password123!",
  name: "New Player",
  home_school_id: "school-1",
  age_confirmed: true as const,
  timezone: "America/Los_Angeles",
  policies_accepted: true as const,
  terms_version: "terms-v1",
  privacy_version: "privacy-v1",
};

async function failWith(error: string, status: number) {
  const fetcher: Fetcher = async () => Response.json({ error }, { status });
  return signupOperation(signupInput, {
    api: createApiClient({ baseUrl: "http://api:8080", fetcher }),
    reportError: () => undefined,
  });
}

test("signup errors about one field name that field for the error summary", async () => {
  assert.deepEqual(
    [
      await failWith("email_already_registered", 409),
      await failWith("home_school_not_found", 422),
      await failWith("rate_limited", 429),
    ],
    [
      {
        status: "error",
        message:
          "That email already has an account. Log in, or reset your password if you forgot it.",
        fieldErrors: {
          email: [
            "That email already has an account. Log in, or reset your password if you forgot it.",
          ],
        },
      },
      {
        status: "error",
        message: "Choose an active home school from the list.",
        fieldErrors: {
          home_school_id: ["Choose an active home school from the list."],
        },
      },
      {
        status: "error",
        message: "Too many attempts. Please try again later.",
      },
    ],
  );
});
