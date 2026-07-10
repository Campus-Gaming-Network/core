import assert from "node:assert/strict";
import test from "node:test";
import {
  ApiError,
  apiRequest,
  buildApiUrl,
  parseSetCookie,
  userMessageForApiError,
  type Fetcher
} from "../lib/cgn-api.js";

const invalidCredentialsFetcher: Fetcher = async () =>
  new Response(JSON.stringify({ error: "invalid_credentials" }), {
    status: 401,
    headers: { "content-type": "application/json" }
  });

test("buildApiUrl normalizes slashes", () => {
  assert.equal(
    buildApiUrl("http://api:8080/", "/schools"),
    "http://api:8080/schools"
  );
  assert.equal(
    buildApiUrl("http://api:8080", "schools?q=osu"),
    "http://api:8080/schools?q=osu"
  );
});

test("apiRequest sends JSON and forwards the incoming cookie header", async () => {
  const calls: Array<{ input: string | URL | Request; init?: RequestInit }> = [];
  const fetcher: Fetcher = async (input, init) => {
    calls.push({ input, init });

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  const result = await apiRequest<{ ok: boolean }>({
    path: "/auth/login",
    method: "POST",
    body: { email: "player@example.com" },
    cookieHeader: "cgn_session=abc",
    baseUrl: "http://api:8080",
    fetcher
  });

  assert.deepEqual(result.data, { ok: true });
  assert.equal(calls[0]?.input, "http://api:8080/auth/login");
  assert.equal(calls[0]?.init?.method, "POST");
  assert.equal(
    new Headers(calls[0]?.init?.headers).get("cookie"),
    "cgn_session=abc"
  );
  assert.equal(
    new Headers(calls[0]?.init?.headers).get("content-type"),
    "application/json"
  );
  assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), {
    email: "player@example.com"
  });
});

test("apiRequest throws ApiError with backend error code", async () => {
  await assert.rejects(
    () =>
      apiRequest({
        path: "/auth/login",
        baseUrl: "http://api:8080",
        fetcher: invalidCredentialsFetcher
      }),
    (error) =>
      error instanceof ApiError &&
      error.status === 401 &&
      error.code === "invalid_credentials"
  );
});

test("parseSetCookie extracts the API session cookie attributes", () => {
  const parsed = parseSetCookie(
    "cgn_session=opaque-value; Path=/; Expires=Wed, 21 Oct 2037 07:28:00 GMT; Max-Age=3600; HttpOnly; SameSite=Lax",
    "cgn_session"
  );

  assert.equal(parsed?.name, "cgn_session");
  assert.equal(parsed?.value, "opaque-value");
  assert.equal(parsed?.path, "/");
  assert.equal(parsed?.maxAge, 3600);
  assert.equal(parsed?.httpOnly, true);
  assert.equal(parsed?.secure, false);
  assert.equal(parsed?.sameSite, "lax");
  assert.equal(parsed?.expires?.getUTCFullYear(), 2037);
});

test("parseSetCookie ignores unexpected cookie names", () => {
  assert.equal(parseSetCookie("other=value; Path=/", "cgn_session"), null);
});

test("userMessageForApiError maps known backend errors", () => {
  assert.equal(
    userMessageForApiError(new ApiError(429, "rate_limited")),
    "Too many attempts. Give it a minute, then try again."
  );
});
