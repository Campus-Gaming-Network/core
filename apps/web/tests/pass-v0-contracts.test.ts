import assert from "node:assert/strict";
import test from "node:test";
import * as z from "zod";
import { eventBodyFromForm } from "../lib/action-payloads.js";
import {
  ApiError,
  apiRequest,
  userMessageForApiError,
  type Fetcher
} from "../lib/cgn-api.js";
import {
  buildCreateEventRequest,
  buildDashboardEventsRequest,
  buildDeleteEventRequest,
  buildEventInterestRequest,
  buildMyTeamsRequest,
  buildResendVerificationRequest,
  buildRsvpEventRequest,
  buildSignupRequest,
  buildTeamJoinRequest,
  buildTransferTeamOwnershipRequest,
  buildUnlockEventRequest
} from "../lib/pass-v0-requests.js";

const baseUrl = "http://api:8080";
const cookieHeader = "cgn_session=abc";
const unlockHeaders = { "X-CGN-Event-Unlock": "unlock-token" };

test("Pass v0 signup request uses the production builder and trims fields", () => {
  const formData = new FormData();
  formData.set("email", " player@example.com ");
  formData.set("password", " password123 ");
  formData.set("name", " Player One ");
  formData.set("home_school_id", " school-1 ");
  formData.set("age_confirmed", "on");

  assert.deepEqual(buildSignupRequest(formData), {
    path: "/auth/signup",
    method: "POST",
    body: {
      email: "player@example.com",
      password: "password123",
      name: "Player One",
      home_school_id: "school-1",
      age_confirmed: true,
      timezone: "America/Los_Angeles"
    }
  });
});

test("Pass v0 resend-verification request uses the production builder", () => {
  const formData = new FormData();
  formData.set("email", " player@example.com ");

  assert.deepEqual(buildResendVerificationRequest(formData), {
    path: "/auth/resend-verification",
    method: "POST",
    body: { email: "player@example.com" }
  });
});

test("Pass v0 event-create request uses the production builder", () => {
  const formData = new FormData();
  formData.set("title", " Smash night ");
  formData.set("host_school_id", "school-1");
  formData.append("game_ids", "game-1");
  formData.set("visibility", "public");
  formData.set("format", "in_person");
  formData.set("starts_at", "2026-08-15T20:00:00Z");
  formData.set("ends_at", "2026-08-15T22:00:00Z");

  assert.deepEqual(buildCreateEventRequest(formData, cookieHeader), {
    path: "/events",
    method: "POST",
    cookieHeader,
    body: eventBodyFromForm(formData)
  });
});

test("Pass v0 private-unlock and cancel requests encode the event slug", () => {
  const formData = new FormData();
  formData.set("password", " secret-pass ");

  assert.deepEqual(buildUnlockEventRequest("private/event", formData), {
    path: "/events/private%2Fevent/unlock",
    method: "POST",
    body: { password: "secret-pass" }
  });
  assert.deepEqual(buildDeleteEventRequest("smash/night", cookieHeader), {
    path: "/events/smash%2Fnight",
    method: "DELETE",
    cookieHeader
  });
});

test("Pass v0 RSVP and interest requests use the production builders", () => {
  const formData = new FormData();
  formData.set("response", " yes ");

  assert.deepEqual(
    buildRsvpEventRequest(
      "smash/night",
      formData,
      cookieHeader,
      unlockHeaders
    ),
    {
      path: "/events/smash%2Fnight/rsvp",
      method: "POST",
      cookieHeader,
      headers: unlockHeaders,
      body: { response: "yes" }
    }
  );
  assert.deepEqual(
    buildEventInterestRequest(
      "smash/night",
      true,
      cookieHeader,
      unlockHeaders
    ),
    {
      path: "/events/smash%2Fnight/interest",
      method: "POST",
      cookieHeader,
      headers: unlockHeaders
    }
  );
  assert.equal(
    buildEventInterestRequest(
      "smash/night",
      false,
      cookieHeader,
      unlockHeaders
    ).method,
    "DELETE"
  );
});

test("Pass v0 team requests use the production builders", () => {
  const formData = new FormData();
  formData.set("password", " team-pass ");

  assert.deepEqual(buildTeamJoinRequest("falcons/a", formData, cookieHeader), {
    path: "/teams/falcons%2Fa/join",
    method: "POST",
    cookieHeader,
    body: { password: "team-pass" }
  });
  assert.deepEqual(
    buildTransferTeamOwnershipRequest("falcons/a", "user-2", cookieHeader),
    {
      path: "/teams/falcons%2Fa/transfer-ownership",
      method: "POST",
      cookieHeader,
      body: { new_owner_user_id: "user-2" }
    }
  );
});

test("Pass v0 dashboard requests use the production builders", () => {
  assert.deepEqual(buildDashboardEventsRequest(5, cookieHeader), {
    path: "/me/events?limit=5",
    cookieHeader
  });
  assert.deepEqual(buildMyTeamsRequest(10, cookieHeader), {
    path: "/me/teams?limit=10",
    cookieHeader
  });
});

test("Pass v0 non-2xx responses preserve status, code, and user message", async () => {
  const cases = [
    [429, "rate_limited", "Too many attempts. Give it a minute, then try again."],
    [409, "event_full", "That event is full."],
    [401, "invalid_private_password", "That event password did not match."],
    [403, "private_event_locked", "Unlock that private event before RSVPing."],
    [400, "invalid_request", "Check the form fields and try again."],
    [401, "invalid_team_password", "That team password did not match."],
    [500, "team_transfer_failed", "We could not transfer ownership. Please try again."],
    [409, "email_already_registered", "That email already has an account."]
  ] as const;

  await Promise.all(
    cases.map(([status, code, message]) =>
      assert.rejects(
        () =>
          apiRequest({
            path: "/contract-error",
            baseUrl,
            fetcher: errorFetcher(status, code),
            responseSchema: z.never()
          }),
        (error) => {
          assert.ok(error instanceof ApiError);
          assert.equal(error.status, status);
          assert.equal(error.code, code);
          assert.equal(userMessageForApiError(error), message);
          return true;
        }
      )
    )
  );
});

function errorFetcher(status: number, code: string): Fetcher {
  return async () =>
    new Response(JSON.stringify({ error: code }), {
      status,
      headers: { "content-type": "application/json" }
    });
}
