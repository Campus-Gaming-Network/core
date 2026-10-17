import assert from "node:assert/strict";
import test from "node:test";
import {
  changeEmailOperation,
  changePasswordOperation,
  confirmEmailChangeOperation,
} from "../src/features/account-slice/account-operations.server.js";
import {
  securityNoticeFieldErrors,
  validateChangeEmailInput,
  validateChangePasswordInput,
} from "../src/features/account-slice/security.js";
import { createApiClient, type Fetcher } from "../src/server/api.server.js";

function client(fetcher: Fetcher) {
  return createApiClient({ baseUrl: "http://api:8080", fetcher });
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

test("password and email forms validate before calling the API", () => {
  assert.deepEqual(
    [
      validateChangePasswordInput(
        form({
          current_password: "OldPassword1",
          new_password: "NewPassword1",
        }),
      ),
      validateChangePasswordInput(
        form({ current_password: "", new_password: "short" }),
      ),
      validateChangeEmailInput(
        form({
          current_password: "OldPassword1",
          new_email: " New@Example.com ",
        }),
      ),
      validateChangeEmailInput(
        form({ current_password: "OldPassword1", new_email: "not an email" }),
      ),
    ],
    [
      {
        valid: true,
        value: {
          current_password: "OldPassword1",
          new_password: "NewPassword1",
        },
      },
      {
        valid: false,
        message: "Check the highlighted fields and try again.",
        fieldErrors: {
          current_password: ["Enter your current password."],
          new_password: ["Use at least 8 characters for your new password."],
        },
      },
      {
        valid: true,
        value: {
          current_password: "OldPassword1",
          new_email: "new@example.com",
        },
      },
      {
        valid: false,
        message: "Check the highlighted fields and try again.",
        fieldErrors: { new_email: ["Enter a valid email address."] },
      },
    ],
  );
});

test("changes send the session cookie to the right endpoint and land on a notice", async () => {
  const calls: Array<{ path: string; cookie: string | null; body: unknown }> =
    [];
  const api = client(async (input, init) => {
    const path = new URL(String(input)).pathname;
    calls.push({
      path,
      cookie: new Headers(init?.headers).get("cookie"),
      body: JSON.parse(String(init?.body)),
    });
    return path === "/me/password"
      ? new Response(null, { status: 204 })
      : Response.json(
          { status: "confirmation_sent_if_available" },
          { status: 202 },
        );
  });
  const dependencies = { api, cookieHeader: "cgn_session=session-value" };

  const results = await Promise.all([
    changePasswordOperation(
      { current_password: "OldPassword1", new_password: "NewPassword1" },
      dependencies,
    ),
    changeEmailOperation(
      { current_password: "OldPassword1", new_email: "new@example.com" },
      dependencies,
    ),
  ]);

  assert.deepEqual(
    {
      calls,
      redirects: results.map((result) =>
        result.status === "success" ? result.redirectTo : result.status,
      ),
    },
    {
      calls: [
        {
          path: "/me/password",
          cookie: "cgn_session=session-value",
          body: {
            current_password: "OldPassword1",
            new_password: "NewPassword1",
          },
        },
        {
          path: "/me/email",
          cookie: "cgn_session=session-value",
          body: {
            current_password: "OldPassword1",
            new_email: "new@example.com",
          },
        },
      ],
      redirects: [
        "/settings/security?security=password-changed",
        "/settings/security?security=email-sent",
      ],
    },
  );
});

test("API refusals become a notice and an error on the field", async () => {
  const refuse = (status: number, error: string) =>
    client(async () => Response.json({ error }, { status }));
  const dependencies = (status: number, error: string) => ({
    api: refuse(status, error),
    cookieHeader: "cgn_session=session-value",
    reportError: () => {},
  });
  const password = { current_password: "Wrong", new_password: "NewPassword1" };
  const email = {
    current_password: "OldPassword1",
    new_email: "new@example.com",
  };

  const results = await Promise.all([
    changePasswordOperation(
      password,
      dependencies(422, "invalid_current_password"),
    ),
    changeEmailOperation(email, dependencies(422, "invalid_current_password")),
    changeEmailOperation(email, dependencies(400, "email_unchanged")),
    changePasswordOperation(password, dependencies(429, "rate_limited")),
    changePasswordOperation(
      password,
      dependencies(503, "database_unavailable"),
    ),
  ]);

  assert.deepEqual(results, [
    {
      status: "error",
      message: "Your current password is incorrect.",
      notice: "password-current",
      fieldErrors: {
        current_password: ["Your current password is incorrect."],
      },
    },
    {
      status: "error",
      message: "Your current password is incorrect.",
      notice: "email-current",
      fieldErrors: {
        current_password: ["Your current password is incorrect."],
      },
    },
    {
      status: "error",
      message: "That is already your email address.",
      notice: "email-unchanged",
      fieldErrors: { new_email: ["That is already your email address."] },
    },
    {
      status: "error",
      message: "Too many attempts. Please wait a few minutes and try again.",
      notice: "rate-limited",
    },
    {
      status: "error",
      message: "We could not change your password. Please try again.",
      notice: "password-failed",
    },
  ]);
  // Without JavaScript, the page puts the same error on the same field, and
  // only on the form it belongs to.
  assert.deepEqual(
    [
      securityNoticeFieldErrors("email-unchanged", "email"),
      securityNoticeFieldErrors("email-unchanged", "password"),
      securityNoticeFieldErrors("password-changed", "password"),
    ],
    [{ new_email: ["That is already your email address."] }, {}, {}],
  );
});

test("confirming a new email sends only the token, never a session", async () => {
  const sent: Array<{ cookie: string | null; body: unknown }> = [];
  const confirmed = await confirmEmailChangeOperation(
    { token: "link-token" },
    {
      api: client(async (_input, init) => {
        sent.push({
          cookie: new Headers(init?.headers).get("cookie"),
          body: JSON.parse(String(init?.body)),
        });
        return Response.json({ status: "email_changed" });
      }),
    },
  );
  const expired = await confirmEmailChangeOperation(
    { token: "old-token" },
    {
      api: client(async () =>
        Response.json({ error: "invalid_or_expired_token" }, { status: 400 }),
      ),
      reportError: () => {},
    },
  );

  assert.deepEqual(
    { confirmed, expired, sent },
    {
      confirmed: { status: "success" },
      expired: {
        status: "error",
        message: "That link is invalid or has expired.",
      },
      sent: [{ cookie: null, body: { token: "link-token" } }],
    },
  );
});
