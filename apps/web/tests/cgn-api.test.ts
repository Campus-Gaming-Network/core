import assert from "node:assert/strict";
import test from "node:test";
import {
  ApiError,
  apiRequest,
  buildApiUrl,
  eventFormatLabel,
  eventLifecycleLabel,
  eventLocation,
  eventRSVPLabel,
  eventVisibilityLabel,
  isSchoolFollowed,
  isLockedEvent,
  parseSetCookie,
  publicProfileHomeSchool,
  schoolLocation,
  teamRoleLabel,
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
  assert.equal(
    userMessageForApiError(new ApiError(403, "not_event_organizer")),
    "Only event organizers can change that event."
  );
  assert.equal(
    userMessageForApiError(new ApiError(401, "invalid_private_password")),
    "That event password did not match."
  );
  assert.equal(
    userMessageForApiError(new ApiError(500, "event_unlock_failed")),
    "We could not unlock that event. Please try again."
  );
  assert.equal(
    userMessageForApiError(new ApiError(409, "event_full")),
    "That event is full."
  );
  assert.equal(
    userMessageForApiError(new ApiError(403, "private_event_locked")),
    "Unlock that private event before RSVPing."
  );
  assert.equal(
    userMessageForApiError(new ApiError(500, "event_rsvp_email_failed")),
    "Your RSVP was saved, but we could not send the confirmation email."
  );
  assert.equal(
    userMessageForApiError(new ApiError(500, "event_interest_failed")),
    "We could not update your interest in that event."
  );
  assert.equal(
    userMessageForApiError(new ApiError(401, "invalid_team_password")),
    "That team password did not match."
  );
  assert.equal(
    userMessageForApiError(new ApiError(500, "team_join_failed")),
    "We could not join that team. Please try again."
  );
  assert.equal(
    userMessageForApiError(new ApiError(403, "not_team_owner")),
    "Only the team owner can manage members."
  );
  assert.equal(
    userMessageForApiError(new ApiError(422, "team_member_not_found")),
    "Choose an active team member."
  );
  assert.equal(
    userMessageForApiError(new ApiError(500, "support_ticket_failed")),
    "We could not submit that support ticket. Please try again."
  );
  assert.equal(
    userMessageForApiError(new ApiError(500, "report_failed")),
    "We could not submit that report. Please try again."
  );
  assert.equal(
    userMessageForApiError(new ApiError(400, "cannot_report_self")),
    "You cannot report your own profile."
  );
});

test("isSchoolFollowed matches by school ID", () => {
  assert.equal(
    isSchoolFollowed(
      [
        {
          id: "school-1",
          name: "Example University",
          slug: "example-university",
          is_main_campus: true,
          num_branches: 0
        }
      ],
      "school-1"
    ),
    true
  );
  assert.equal(isSchoolFollowed([], "school-1"), false);
});

test("schoolLocation formats city and state with fallback", () => {
  assert.equal(schoolLocation({ city: "Irvine", state: "CA" }), "Irvine, CA");
  assert.equal(schoolLocation({ state: "CA" }), "CA");
  assert.equal(schoolLocation({}, "Online"), "Online");
});

test("publicProfileHomeSchool prefers display summary over raw ID", () => {
  assert.deepEqual(
    publicProfileHomeSchool({
      id: "user-1",
      name: "Player",
      verification_level: "basic",
      home_school_id: "school-1",
      home_school: {
        id: "school-1",
        name: "Example University",
        slug: "example-university",
        city: "Irvine",
        state: "CA"
      }
    }),
    {
      name: "Example University",
      location: "Irvine, CA",
      href: "/schools/example-university"
    }
  );
  assert.deepEqual(
    publicProfileHomeSchool({
      id: "user-1",
      name: "Player",
      verification_level: "basic",
      home_school_id: "school-1"
    }),
    {
      name: "school-1",
      location: "",
      href: undefined
    }
  );
});

test("event helpers format labels and locations", () => {
  assert.equal(eventLifecycleLabel("happening_now"), "Happening now");
  assert.equal(eventVisibilityLabel("unlisted"), "Unlisted");
  assert.equal(eventFormatLabel("in_person"), "In person");
  assert.equal(eventRSVPLabel("maybe"), "Maybe");
  assert.equal(
    eventLocation({
      format: "hybrid",
      location_name: "Student Union",
      address: "1 Campus Way",
      online_url: "https://meet.example.test/event"
    }),
    "Student Union · 1 Campus Way + online"
  );
  assert.equal(
    eventLocation({
      format: "online",
      online_url: "https://meet.example.test/event"
    }),
    "Online"
  );
});

test("team helpers format member roles", () => {
  assert.equal(teamRoleLabel("owner"), "Owner");
  assert.equal(teamRoleLabel("captain"), "Captain");
  assert.equal(teamRoleLabel("member"), "Member");
});

test("isLockedEvent detects private locked shell responses", () => {
  assert.equal(
    isLockedEvent({
      slug: "private-event",
      visibility: "private",
      locked: true
    }),
    true
  );
  assert.equal(
    isLockedEvent({
      id: "event-1",
      title: "Public Event",
      slug: "public-event",
      description: "",
      visibility: "public",
      format: "online",
      starts_at: "2026-08-15T20:00:00Z",
      ends_at: "2026-08-15T22:00:00Z",
      timezone: "America/Los_Angeles",
      rsvp_yes_count: 0,
      interest_count: 0,
      lifecycle: "upcoming",
      is_paid: false,
      host_school: {
        id: "school-1",
        name: "Example University",
        slug: "example-university"
      },
      games: []
    }),
    false
  );
});
