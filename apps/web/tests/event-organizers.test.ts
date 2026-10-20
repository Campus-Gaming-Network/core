import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { createApiClient, type Fetcher } from "../src/server/api.server.js";
import {
  validateAcceptOrganizerInviteSearch,
  validateInviteOrganizerInput,
  validateOrganizerInput,
  validateOrganizerSearch,
} from "../src/features/event-organizers/contracts.js";
import {
  acceptOrganizerInviteOperation,
  inviteOrganizerOperation,
  leaveOrganizersOperation,
  organizerInvitesOperation,
  removeOrganizerOperation,
  revokeOrganizerInviteOperation,
  transferCreatorOperation,
} from "../src/features/event-organizers/organizer-operations.server.js";
import { bodyText, requestURL } from "./fetch-stub.js";

const userID = "55555555-5555-4555-8555-555555555555";
const inviteID = "66666666-6666-4666-8666-666666666666";
const invite = {
  id: inviteID,
  email: "guest@example.test",
  expires_at: "2026-10-24T12:00:00Z",
  created_at: "2026-10-17T12:00:00Z",
};

function client(fetcher: Fetcher) {
  return createApiClient({ baseUrl: "http://api:8080", fetcher });
}

test("organizer changes call the named endpoints and return to the edit page or the event", async () => {
  const calls: Array<{ body?: unknown; method?: string; url: string }> = [];
  const api = client(async (input, init) => {
    calls.push({
      ...(init?.body ? { body: JSON.parse(bodyText(init)) } : {}),
      method: init?.method,
      url: requestURL(input),
    });
    if (requestURL(input).endsWith("/organizer-invites")) {
      return Response.json(
        init?.method === "POST" ? invite : { invites: [invite] },
        { status: init?.method === "POST" ? 201 : 200 },
      );
    }
    if (requestURL(input).endsWith("/accept")) {
      return Response.json({ event_slug: "campus-chess" });
    }
    return new Response(null, { status: 204 });
  });
  const dependencies = { api, cookieHeader: "cgn_session=server-only" };
  const slug = "campus-chess";

  const results = [
    await organizerInvitesOperation({ slug }, dependencies),
    await inviteOrganizerOperation(
      { slug, email: "guest@example.test" },
      dependencies,
    ),
    await revokeOrganizerInviteOperation(
      { slug, invite_id: inviteID },
      dependencies,
    ),
    await removeOrganizerOperation({ slug, user_id: userID }, dependencies),
    await leaveOrganizersOperation({ slug, user_id: userID }, dependencies),
    await transferCreatorOperation({ slug, user_id: userID }, dependencies),
    await acceptOrganizerInviteOperation({ token: "raw" }, dependencies),
  ];

  const base = "http://api:8080/events/campus-chess";
  assert.deepEqual(
    { calls, results },
    {
      calls: [
        { method: "GET", url: `${base}/organizer-invites` },
        {
          body: { email: "guest@example.test" },
          method: "POST",
          url: `${base}/organizer-invites`,
        },
        { method: "DELETE", url: `${base}/organizer-invites/${inviteID}` },
        { method: "DELETE", url: `${base}/organizers/${userID}` },
        { method: "DELETE", url: `${base}/organizers/${userID}` },
        { method: "POST", url: `${base}/organizers/${userID}/creator` },
        {
          body: { token: "raw" },
          method: "POST",
          url: "http://api:8080/organizer-invites/accept",
        },
      ],
      results: [
        { status: "ready", invites: [invite] },
        ...["invited", "withdrawn", "removed"].map((notice) => ({
          status: "success",
          redirectTo: `/events/campus-chess/edit?organizers=${notice}#organizers`,
        })),
        {
          status: "success",
          redirectTo: "/events/campus-chess?event=organizer-left",
        },
        {
          status: "success",
          redirectTo:
            "/events/campus-chess/edit?organizers=transferred#organizers",
        },
        {
          status: "success",
          redirectTo: "/events/campus-chess?event=organizer-joined",
        },
      ],
    },
  );
});

test("a failed invite or acceptance names what went wrong without losing the link", async () => {
  const failing = (error: string, status: number) => ({
    api: client(async () => Response.json({ error }, { status })),
    cookieHeader: "",
    reportError: () => {},
  });
  const invite = (error: string, status: number) =>
    inviteOrganizerOperation(
      { slug: "campus-chess", email: "guest@example.test" },
      failing(error, status),
    );
  const accept = (error: string, status: number) =>
    acceptOrganizerInviteOperation({ token: "a+b" }, failing(error, status));

  assert.deepEqual(
    (
      await Promise.all([
        invite("organizer_limit_reached", 409),
        invite("invalid_email", 400),
        invite("not_event_creator", 403),
        accept("organizer_invite_not_found", 404),
        accept("organizer_invite_wrong_account", 403),
        accept("authentication_required", 401),
        accept("internal_error", 500),
      ])
    ).map((result) => result.redirectTo),
    [
      "/events/campus-chess/edit?organizers=invite-limit#organizers",
      "/events/campus-chess/edit?organizers=invalid-email#organizers",
      "/events/campus-chess/edit?organizers=failed#organizers",
      "/organizer-invite?token=a%2Bb&result=invalid",
      "/organizer-invite?token=a%2Bb&result=wrong-account",
      "/login?next=%2Forganizer-invite%3Ftoken%3Da%252Bb",
      "/organizer-invite?token=a%2Bb&result=failed",
    ],
  );
});

test("organizer forms and searches keep only known values", () => {
  const invite = new FormData();
  invite.set("slug", " campus-chess ");
  invite.set("email", " guest@example.test ");
  const badEmail = new FormData();
  badEmail.set("slug", "campus-chess");
  badEmail.set("email", "not an address");

  assert.deepEqual(
    [
      validateInviteOrganizerInput(invite),
      validateInviteOrganizerInput(badEmail),
      validateOrganizerInput({ slug: "campus-chess", user_id: "nope" }),
      validateOrganizerInput({ slug: "campus-chess", user_id: userID }),
      validateOrganizerSearch({ organizers: "invited" }),
      validateOrganizerSearch({ organizers: "<script>" }),
      validateAcceptOrganizerInviteSearch({ token: "raw", result: "invalid" }),
      validateAcceptOrganizerInviteSearch({ token: "", result: "other" }),
    ],
    [
      {
        valid: true,
        value: { slug: "campus-chess", email: "guest@example.test" },
      },
      { valid: false, slug: "campus-chess" },
      { valid: false, slug: "campus-chess" },
      { valid: true, value: { slug: "campus-chess", user_id: userID } },
      { organizers: "invited" },
      {},
      { token: "raw", result: "invalid" },
      {},
    ],
  );
});
