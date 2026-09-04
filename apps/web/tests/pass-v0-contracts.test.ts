import assert from "node:assert/strict";
import test from "node:test";
import {
  ApiError,
  apiRequest,
  userMessageForApiError,
  type Fetcher
} from "../lib/cgn-api.js";

const baseUrl = "http://api:8080";

function jsonFetcher(
  status: number,
  body: unknown,
  capture: Array<{ input: string; init?: RequestInit }>
): Fetcher {
  return async (input, init) => {
    capture.push({ input: String(input), init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" }
    });
  };
}

test("Pass v0 signup posts /auth/signup with trimmed account fields", async () => {
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  const fetcher = jsonFetcher(201, { id: "user-1" }, calls);

  await apiRequest({
    path: "/auth/signup",
    method: "POST",
    baseUrl,
    fetcher,
    body: {
      email: "player@example.com",
      password: "password123",
      name: "Player One",
      home_school_id: "school-1",
      age_confirmed: true,
      timezone: "America/Los_Angeles"
    }
  });

  assert.equal(calls[0]?.input, `${baseUrl}/auth/signup`);
  assert.equal(calls[0]?.init?.method, "POST");
  assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), {
    email: "player@example.com",
    password: "password123",
    name: "Player One",
    home_school_id: "school-1",
    age_confirmed: true,
    timezone: "America/Los_Angeles"
  });
});

test("Pass v0 resend verification posts /auth/resend-verification", async () => {
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  const fetcher = jsonFetcher(200, { status: "ok" }, calls);

  await apiRequest({
    path: "/auth/resend-verification",
    method: "POST",
    baseUrl,
    fetcher,
    body: { email: "player@example.com" }
  });

  assert.equal(calls[0]?.input, `${baseUrl}/auth/resend-verification`);
  assert.equal(calls[0]?.init?.method, "POST");
});

test("Pass v0 event create posts /events", async () => {
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  const fetcher = jsonFetcher(201, { slug: "smash-night-abcd1234" }, calls);

  await apiRequest({
    path: "/events",
    method: "POST",
    baseUrl,
    fetcher,
    cookieHeader: "cgn_session=abc",
    body: {
      title: "Smash night",
      host_school_id: "school-1",
      game_ids: ["game-1"],
      visibility: "public",
      format: "in_person",
      starts_at: "2026-08-15T20:00:00Z",
      ends_at: "2026-08-15T22:00:00Z"
    }
  });

  assert.equal(calls[0]?.input, `${baseUrl}/events`);
  assert.equal(calls[0]?.init?.method, "POST");
  assert.equal(
    new Headers(calls[0]?.init?.headers).get("cookie"),
    "cgn_session=abc"
  );
});

test("Pass v0 private unlock posts /events/:slug/unlock", async () => {
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  const fetcher = jsonFetcher(
    200,
    {
      event: { slug: "private-event" },
      unlock_token: "token",
      expires_at: "2037-01-01T00:00:00Z"
    },
    calls
  );

  await apiRequest({
    path: "/events/private-event/unlock",
    method: "POST",
    baseUrl,
    fetcher,
    body: { password: "secret-pass" }
  });

  assert.equal(calls[0]?.input, `${baseUrl}/events/private-event/unlock`);
  assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), {
    password: "secret-pass"
  });
});

test("Pass v0 event cancel deletes /events/:slug", async () => {
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  const emptyFetcher: Fetcher = async (input, init) => {
    calls.push({ input: String(input), init });
    return new Response(null, { status: 204 });
  };

  await apiRequest({
    path: "/events/smash-night",
    method: "DELETE",
    baseUrl,
    fetcher: emptyFetcher,
    cookieHeader: "cgn_session=abc"
  });

  assert.equal(calls[0]?.input, `${baseUrl}/events/smash-night`);
  assert.equal(calls[0]?.init?.method, "DELETE");
});

test("Pass v0 RSVP posts /events/:slug/rsvp with unlock header support", async () => {
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  const fetcher = jsonFetcher(200, { slug: "smash-night" }, calls);

  await apiRequest({
    path: "/events/smash-night/rsvp",
    method: "POST",
    baseUrl,
    fetcher,
    cookieHeader: "cgn_session=abc",
    headers: { "X-CGN-Event-Unlock": "unlock-token" },
    body: { response: "yes" }
  });

  assert.equal(calls[0]?.input, `${baseUrl}/events/smash-night/rsvp`);
  assert.equal(
    new Headers(calls[0]?.init?.headers).get("x-cgn-event-unlock"),
    "unlock-token"
  );
  assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), {
    response: "yes"
  });
});

test("Pass v0 interest posts and deletes /events/:slug/interest", async () => {
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  const fetcher = jsonFetcher(200, { slug: "smash-night" }, calls);

  await apiRequest({
    path: "/events/smash-night/interest",
    method: "POST",
    baseUrl,
    fetcher,
    cookieHeader: "cgn_session=abc"
  });
  await apiRequest({
    path: "/events/smash-night/interest",
    method: "DELETE",
    baseUrl,
    fetcher,
    cookieHeader: "cgn_session=abc"
  });

  assert.equal(calls[0]?.init?.method, "POST");
  assert.equal(calls[1]?.init?.method, "DELETE");
  assert.equal(calls[0]?.input, `${baseUrl}/events/smash-night/interest`);
});

test("Pass v0 team join posts /teams/:slug/join", async () => {
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  const fetcher = jsonFetcher(200, { slug: "falcons" }, calls);

  await apiRequest({
    path: "/teams/falcons/join",
    method: "POST",
    baseUrl,
    fetcher,
    cookieHeader: "cgn_session=abc",
    body: { password: "team-pass" }
  });

  assert.equal(calls[0]?.input, `${baseUrl}/teams/falcons/join`);
  assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), {
    password: "team-pass"
  });
});

test("Pass v0 ownership transfer posts /teams/:slug/transfer-ownership", async () => {
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  const fetcher = jsonFetcher(200, { slug: "falcons" }, calls);

  await apiRequest({
    path: "/teams/falcons/transfer-ownership",
    method: "POST",
    baseUrl,
    fetcher,
    cookieHeader: "cgn_session=abc",
    body: { new_owner_user_id: "user-2" }
  });

  assert.equal(
    calls[0]?.input,
    `${baseUrl}/teams/falcons/transfer-ownership`
  );
});

test("Pass v0 dashboard reads /me/events and /me/teams", async () => {
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  const fetcher = jsonFetcher(
    200,
    { upcoming_rsvps: [], followed_school_events: [], teams: [] },
    calls
  );

  await apiRequest({
    path: "/me/events?limit=5",
    baseUrl,
    fetcher,
    cookieHeader: "cgn_session=abc"
  });
  await apiRequest({
    path: "/me/teams?limit=10",
    baseUrl,
    fetcher,
    cookieHeader: "cgn_session=abc"
  });

  assert.equal(calls[0]?.input, `${baseUrl}/me/events?limit=5`);
  assert.equal(calls[1]?.input, `${baseUrl}/me/teams?limit=10`);
  assert.equal(
    new Headers(calls[0]?.init?.headers).get("cookie"),
    "cgn_session=abc"
  );
});

test("Pass v0 failure codes map to user-facing messages", () => {
  assert.equal(
    userMessageForApiError(new ApiError(429, "rate_limited")),
    "Too many attempts. Give it a minute, then try again."
  );
  assert.equal(
    userMessageForApiError(new ApiError(409, "event_full")),
    "That event is full."
  );
  assert.equal(
    userMessageForApiError(new ApiError(401, "invalid_private_password")),
    "That event password did not match."
  );
  assert.equal(
    userMessageForApiError(new ApiError(403, "private_event_locked")),
    "Unlock that private event before RSVPing."
  );
  assert.equal(
    userMessageForApiError(new ApiError(400, "invalid_request")),
    "Check the form fields and try again."
  );
  assert.equal(
    userMessageForApiError(new ApiError(401, "invalid_team_password")),
    "That team password did not match."
  );
  assert.equal(
    userMessageForApiError(new ApiError(500, "team_transfer_failed")),
    "We could not transfer ownership. Please try again."
  );
  assert.equal(
    userMessageForApiError(new ApiError(409, "email_already_registered")),
    "That email already has an account."
  );
});
