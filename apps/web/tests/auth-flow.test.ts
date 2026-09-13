import assert from "node:assert/strict";
import test from "node:test";
import {
  forgotPasswordOperation,
  resendVerificationOperation,
  resetPasswordOperation,
  signupOperation,
  verifyEmailOperation
} from "../src/features/auth-flow-slice/auth-flow-operations.server.js";
import {
  legacyResetDestination,
  validateEmailServerInput,
  validateForgotPasswordSearch,
  validateResetPasswordSearch,
  validateSignupSearch,
  validateSignupServerInput,
  validateVerificationTokenServerInput,
  validateVerifyEmailSearch
} from "../src/features/auth-flow-slice/contracts.js";
import { authPageHead } from "../src/features/auth-flow-slice/presentation.js";
import { signupSchoolSearchOperation } from "../src/features/auth-flow-slice/signup-school-operations.server.js";
import { createApiClient, type Fetcher } from "../src/server/api.server.js";

const profile = {
  id: "user-1",
  email: "new@example.test",
  verification_level: "basic",
  name: "New Player",
  timezone: "America/Los_Angeles",
  home_school_id: "school-1"
};

const signupInput = {
  email: "new@example.test",
  password: "Password123!",
  name: "New Player",
  home_school_id: "school-1",
  age_confirmed: true as const,
  timezone: "America/Los_Angeles"
};

function client(fetcher: Fetcher) {
  return createApiClient({ baseUrl: "http://api:8080", fetcher });
}

test("auth search parsing is tolerant, first-value-only, and enum safe", () => {
  assert.deepEqual(validateSignupSearch({
    q: ["  Zzyzx  ", "ignored"],
    school_id: ["school-1", "school-2"],
    auth: "failed",
    extra: { private: true }
  }), { q: "Zzyzx", school_id: "school-1", auth: "failed" });
  assert.deepEqual(validateSignupSearch({ auth: "created" }), {
    auth: "created"
  });
  assert.deepEqual(validateSignupSearch({ q: "x".repeat(201), auth: "other" }), {});
  assert.deepEqual(validateForgotPasswordSearch({ request: ["sent", "failed"] }), {
    request: "sent"
  });
  assert.deepEqual(validateResetPasswordSearch({ token: [" token-1 ", "ignored"], reset: "failed" }), {
    token: " token-1 ",
    reset: "failed"
  });
  assert.deepEqual(validateVerifyEmailSearch({
    token: ["verify-token", "ignored"],
    error: "invalid-link",
    resend: "sent",
    verified: "unknown"
  }), { token: "verify-token", error: "invalid-link", resend: "sent" });
});

test("legacy reset compatibility preserves the first token with exact encoding", () => {
  assert.equal(legacyResetDestination(""), "/reset-password");
  assert.equal(
    legacyResetDestination("token with /?&=✓"),
    "/reset-password?token=token%20with%20%2F%3F%26%3D%E2%9C%93"
  );
});

test("signup validates typed and native inputs with accessible field errors", () => {
  const form = new FormData();
  form.set("email", " new@example.test ");
  form.set("password", " Password123! ");
  form.set("name", " New Player ");
  form.set("home_school_id", " school-1 ");
  form.set("age_confirmed", "on");

  assert.deepEqual(validateSignupServerInput(form), {
    valid: true,
    value: signupInput
  });
  assert.deepEqual(validateSignupServerInput(signupInput), {
    valid: true,
    value: signupInput
  });

  const invalid = validateSignupServerInput({
    ...signupInput,
    email: "private-invalid-address",
    password: "secret",
    home_school_id: "",
    age_confirmed: false as true
  });
  assert.equal(invalid.valid, false);
  if (invalid.valid) assert.fail("invalid signup passed");
  assert.deepEqual(invalid.fieldErrors.email, ["Enter a valid email address."]);
  assert.deepEqual(invalid.fieldErrors.password, ["Password must be at least 8 characters."]);
  assert.deepEqual(invalid.fieldErrors.home_school_id, ["Choose a home school."]);
  assert.deepEqual(invalid.fieldErrors.age_confirmed, ["Confirm that you are 18 or older."]);
  assert.equal(JSON.stringify(invalid).includes("private-invalid-address"), false);
  assert.equal(JSON.stringify(invalid).includes("secret"), false);
});

test("email and token validation trims accepted data without echoing rejected PII", () => {
  const email = new FormData();
  email.set("email", " player@example.test ");
  assert.deepEqual(validateEmailServerInput(email), {
    valid: true,
    value: { email: "player@example.test" }
  });

  const token = new FormData();
  token.set("token", " verify-secret ");
  assert.deepEqual(validateVerificationTokenServerInput(token), {
    valid: true,
    value: { token: "verify-secret" }
  });

  const invalid = validateEmailServerInput({ email: "private-address" });
  assert.equal(JSON.stringify(invalid).includes("private-address"), false);
});

test("signup posts only its validated contract and strips the upstream profile", async () => {
  let url = "";
  let init: RequestInit | undefined;
  const result = await signupOperation(signupInput, {
    api: client(async (input, requestInit) => {
      url = String(input);
      init = requestInit;
      return Response.json({
        ...profile,
        session_token: "never-return",
        private_note: "never-return"
      }, { status: 201 });
    })
  });

  assert.equal(url, "http://api:8080/auth/signup");
  assert.equal(init?.method, "POST");
  assert.equal(init?.cache, "no-store");
  assert.deepEqual(JSON.parse(String(init?.body)), signupInput);
  assert.deepEqual(result, {
    status: "success",
    message: "Account created. Check your email for the verification link before logging in."
  });
  assert.equal(JSON.stringify(result).includes("new@example.test"), false);
  assert.equal(JSON.stringify(result).includes("Password123"), false);
  assert.equal(JSON.stringify(result).includes("never-return"), false);
});

test("forgot and resend responses are enumeration-safe and contract checked", async () => {
  const requests: string[] = [];
  const api = client(async (input) => {
    requests.push(String(input));
    return Response.json({ status: "if_account_exists_email_sent", private: "strip" }, {
      status: 202
    });
  });
  const forgot = await forgotPasswordOperation({ email: "person@example.test" }, { api });
  const resend = await resendVerificationOperation({ email: "person@example.test" }, { api });

  assert.deepEqual(forgot, {
    status: "success",
    message: "If that account exists, a password reset link is on the way."
  });
  assert.deepEqual(resend, {
    status: "success",
    message: "If that account needs verification, another email is on the way."
  });
  assert.deepEqual(requests, [
    "http://api:8080/auth/forgot-password",
    "http://api:8080/auth/resend-verification"
  ]);
  assert.equal(JSON.stringify([forgot, resend]).includes("person@example.test"), false);

  const malformed = await forgotPasswordOperation(
    { email: "person@example.test" },
    {
      api: client(async () => Response.json({ unexpected: true })),
      reportError: () => undefined
    }
  );
  assert.deepEqual(malformed, {
    status: "error",
    message: "Something went wrong. Please try again."
  });
});

test("reset and verification keep secrets out of results and map used links safely", async () => {
  let resetBody = "";
  const reset = await resetPasswordOperation(
    { token: "reset-secret", password: "Password123!" },
    {
      api: client(async (_input, init) => {
        resetBody = String(init?.body);
        return new Response(null, { status: 204 });
      })
    }
  );
  assert.equal(resetBody, JSON.stringify({ token: "reset-secret", password: "Password123!" }));
  assert.deepEqual(reset, {
    status: "success",
    message: "Password reset.",
    redirectTo: "/login?reset=complete"
  });
  assert.equal(JSON.stringify(reset).includes("reset-secret"), false);
  assert.equal(JSON.stringify(reset).includes("Password123"), false);

  const verification = await verifyEmailOperation(
    { token: "used-verification-secret" },
    {
      api: client(async () => Response.json(
        { error: "invalid_or_expired_token" },
        { status: 400 }
      )),
      reportError: () => undefined
    }
  );
  assert.deepEqual(verification, {
    status: "error",
    message: "That link is invalid or has expired."
  });
  assert.equal(JSON.stringify(verification).includes("used-verification-secret"), false);
});

test("signup school search keeps the exact threshold, limit, DTO, and safe failure", async () => {
  let calls = 0;
  let requested = "";
  const api = client(async (input) => {
    calls += 1;
    requested = String(input);
    return Response.json({
      schools: [{
        id: "school-1",
        name: "Example University",
        slug: "example-university",
        city: "Irvine",
        state: "CA",
        is_main_campus: true,
        num_branches: 0,
        private_note: "strip-me"
      }],
      limit: 50,
      offset: 0,
      has_more: false
    });
  });

  assert.deepEqual(await signupSchoolSearchOperation("x", { api }), {
    schools: [], failed: false
  });
  assert.equal(calls, 0);
  const found = await signupSchoolSearchOperation("  Example  ", { api });
  assert.equal(requested, "http://api:8080/schools?q=++Example++&limit=50");
  assert.equal(JSON.stringify(found).includes("private_note"), false);
  assert.equal(found.failed, false);

  const failed = await signupSchoolSearchOperation("failure", {
    api: client(async () => { throw new Error("private upstream endpoint"); }),
    reportError: () => undefined
  });
  assert.deepEqual(failed, { schools: [], failed: true });
});

test("auth metadata preserves canonical previews and noindex recovery policy", () => {
  const forgot = authPageHead("https://cgn.example", {
    title: "Forgot password",
    description: "Request a reset link.",
    path: "/forgot-password",
    noIndex: true
  });
  assert.ok(forgot.meta.some((entry) => entry.name === "robots" && entry.content === "noindex,nofollow"));
  assert.ok(forgot.meta.some((entry) => entry.property === "og:url" && entry.content === "https://cgn.example/forgot-password"));

  const signup = authPageHead("https://cgn.example", {
    title: "Sign up",
    description: "Create an account.",
    path: "/signup"
  });
  assert.equal(signup.meta.some((entry) => entry.name === "robots"), false);
});
