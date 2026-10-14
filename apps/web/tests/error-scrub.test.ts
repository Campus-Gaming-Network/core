import assert from "node:assert/strict";
import test from "node:test";

import type { ErrorEvent } from "@sentry/browser";

import { scrubEvent, scrubText } from "../src/error-scrub.js";

const fakeEmail = "pat.example@fake.invalid";
const fakeToken = "tok-fake-0123456789";
const fakePassword = "pw-fake-hunter2";

test("scrubText masks emails, credential parameters, and bearer values", () => {
  assert.equal(
    scrubText(
      `no ${fakeEmail} at /verify?token=${fakeToken}&next=/home with Bearer ${fakeToken}`,
    ),
    "no [email] at /verify?token=[redacted]&next=/home with Bearer [redacted]",
  );
});

test("scrubEvent leaves no email, token, or password in an event", () => {
  const event = {
    message: `failed for ${fakeEmail}`,
    transaction: `GET /reset-password?token=${fakeToken}`,
    request: {
      url: `https://example.invalid/reset-password?token=${fakeToken}#${fakePassword}`,
      cookies: { session: fakeToken },
      headers: { authorization: `Bearer ${fakeToken}` },
    },
    user: { email: fakeEmail },
    breadcrumbs: [{ message: fakePassword }],
    tags: { runtime: "server", user_email: fakeEmail },
    extra: { password: fakePassword, note: `see ${fakeEmail}` },
    contexts: { app: { api_key: fakeToken } },
    exception: {
      values: [
        {
          value: `password=${fakePassword} for ${fakeEmail}`,
          stacktrace: { frames: [{ vars: { password: fakePassword } }] },
        },
      ],
    },
  } as unknown as ErrorEvent;

  assert.deepEqual(scrubEvent(event, { keepUrl: true }), {
    message: "failed for [email]",
    transaction: "GET /reset-password?token=[redacted]",
    request: { url: "https://example.invalid/reset-password" },
    tags: { runtime: "server", user_email: "[redacted]" },
    extra: { password: "[redacted]", note: "see [email]" },
    contexts: { app: { api_key: "[redacted]" } },
    exception: {
      values: [
        {
          value: "password=[redacted] for [email]",
          stacktrace: { frames: [{}] },
        },
      ],
    },
  });
});

test("scrubEvent drops the request when the URL is not kept", () => {
  const event = {
    request: { url: `https://example.invalid/?token=${fakeToken}` },
  } as ErrorEvent;

  assert.deepEqual(scrubEvent(event), { request: undefined });
});
