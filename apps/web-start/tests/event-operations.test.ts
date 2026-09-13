import assert from "node:assert/strict";
import test from "node:test";
import { createApiClient, type Fetcher } from "../src/server/api.server.js";
import {
  eventUnlockCookieName,
  type CookieMutation
} from "../src/server/cookies.server.js";
import {
  getEventDetailOperation,
  rsvpEventOperation,
  unlockEventOperation
} from "../src/features/event-slice/event-operations.server.js";
import {
  validateRSVPServerInput,
  validateUnlockServerInput
} from "../src/features/event-slice/contracts.js";

const event = {
  id: "event-1",
  title: "Campus tournament",
  slug: "campus-tournament",
  description: "",
  visibility: "private",
  format: "in_person",
  starts_at: "2037-02-20T02:00:00Z",
  ends_at: "2037-02-20T05:00:00Z",
  timezone: "America/Los_Angeles",
  rsvp_yes_count: 3,
  interest_count: 4,
  lifecycle: "upcoming",
  is_paid: false,
  host_school: { id: "school-1", name: "Example University", slug: "example" },
  games: [{ id: "game-1", name: "Example Game", slug: "example-game" }]
};

function client(fetcher: Fetcher) {
  return createApiClient({
    baseUrl: "http://api:8080",
    fetcher
  });
}

test("event detail forwards viewer credentials and preserves a redacted locked shell", async () => {
  let init: RequestInit | undefined;
  const result = await getEventDetailOperation(
    { slug: "private/event" },
    {
      api: client(async (_input, requestInit) => {
        init = requestInit;
        return Response.json({
          slug: "private-event",
          visibility: "private",
          locked: true,
          unlock_token: "must-not-serialize",
          session: "must-not-serialize",
          "X-CGN-Visitor-IP": "must-not-serialize"
        });
      }),
      cookieHeader: "cgn_session=session-value",
      unlockHeaders: { "X-CGN-Event-Unlock": "unlock-value" }
    }
  );

  assert.equal(new Headers(init?.headers).get("cookie"), "cgn_session=session-value");
  assert.equal(new Headers(init?.headers).get("x-cgn-event-unlock"), "unlock-value");
  assert.equal(init?.cache, "no-store");
  assert.deepEqual(result, {
    status: "found",
    event: { slug: "private-event", visibility: "private", locked: true }
  });
  assert.equal(JSON.stringify(result).includes("must-not-serialize"), false);
});

test("event detail distinguishes an upstream 404 from a locked event", async () => {
  const result = await getEventDetailOperation(
    { slug: "missing" },
    {
      api: client(async () =>
        Response.json({ error: "event_not_found" }, { status: 404 })
      ),
      cookieHeader: ""
    }
  );

  assert.deepEqual(result, { status: "not_found" });
});

test("unlock posts only the password, stores a secure root cookie, and never returns the token", async () => {
  let init: RequestInit | undefined;
  const cookies: CookieMutation[] = [];
  const result = await unlockEventOperation(
    { slug: "private/event", password: "open sesame" },
    {
      api: client(async (_input, requestInit) => {
        init = requestInit;
        return Response.json({
          event,
          unlock_token: "server-only-unlock-token",
          expires_at: "2037-02-20T01:00:00Z"
        });
      }),
      production: true,
      applyCookie: (cookie) => cookies.push(cookie)
    }
  );

  assert.equal(init?.body, JSON.stringify({ password: "open sesame" }));
  assert.deepEqual(cookies, [
    {
      kind: "set",
      name: eventUnlockCookieName("private/event"),
      value: "server-only-unlock-token",
      options: {
        path: "/",
        expires: new Date("2037-02-20T01:00:00Z"),
        httpOnly: true,
        secure: true,
        sameSite: "lax"
      }
    }
  ]);
  assert.equal(result.status, "success");
  assert.equal(JSON.stringify(result).includes("server-only-unlock-token"), false);
});

test("RSVP forwards session/unlock state, exact payload, and strips additive response fields", async () => {
  let input: string | URL | Request | undefined;
  let init: RequestInit | undefined;
  const result = await rsvpEventOperation(
    { slug: "private/event", response: "maybe" },
    {
      api: client(async (requestInput, requestInit) => {
        input = requestInput;
        init = requestInit;
        return Response.json({ ...event, unlock_token: "leak", session: "leak" });
      }),
      cookieHeader: "cgn_session=session-value",
      unlockHeaders: { "X-CGN-Event-Unlock": "unlock-value" }
    }
  );

  assert.equal(input, "http://api:8080/events/private%2Fevent/rsvp");
  assert.equal(init?.body, JSON.stringify({ response: "maybe" }));
  assert.equal(new Headers(init?.headers).get("cookie"), "cgn_session=session-value");
  assert.equal(new Headers(init?.headers).get("x-cgn-event-unlock"), "unlock-value");
  assert.equal(result.status, "success");
  assert.equal(JSON.stringify(result).includes("leak"), false);
});

test("event operation failures return safe messages", async () => {
  const result = await unlockEventOperation(
    { slug: "private", password: "wrong" },
    {
      api: client(async () =>
        Response.json({ error: "invalid_private_password" }, { status: 401 })
      ),
      production: false,
      applyCookie: () => undefined
    }
  );

  assert.deepEqual(result, {
    status: "error",
    message: "That event password did not match."
  });
});

test("event mutations validate typed RPC data and native FormData", () => {
  const unlock = new FormData();
  unlock.set("slug", " private/event ");
  unlock.set("password", " open sesame ");
  const rsvp = new FormData();
  rsvp.set("slug", "private/event");
  rsvp.set("response", "yes");

  assert.deepEqual(validateUnlockServerInput(unlock), {
    valid: true,
    value: { slug: "private/event", password: "open sesame" }
  });
  assert.deepEqual(validateRSVPServerInput(rsvp), {
    valid: true,
    value: { slug: "private/event", response: "yes" }
  });
  assert.deepEqual(
    validateUnlockServerInput({
      slug: " private/event ",
      password: " open sesame "
    }),
    validateUnlockServerInput(unlock)
  );
  assert.deepEqual(
    validateRSVPServerInput({ slug: " private/event ", response: " yes " as "yes" }),
    validateRSVPServerInput(rsvp)
  );
});

test("event validation enforces password parity and returns field errors", () => {
  const shortPassword = validateUnlockServerInput({
    slug: "private/event",
    password: "short"
  });
  const invalidRSVP = new FormData();
  invalidRSVP.set("slug", "private/event");
  invalidRSVP.set("response", "unknown");
  const response = validateRSVPServerInput(invalidRSVP);

  assert.equal(shortPassword.valid, false);
  if (shortPassword.valid) {
    assert.fail("short event password unexpectedly passed validation");
  }
  assert.deepEqual(shortPassword.fieldErrors.password, [
    "Password must be at least 8 characters."
  ]);

  assert.equal(response.valid, false);
  if (response.valid) {
    assert.fail("invalid RSVP unexpectedly passed validation");
  }
  assert.deepEqual(response.fieldErrors.response, [
    "Invalid option: expected one of \"yes\"|\"maybe\"|\"no\""
  ]);
});
