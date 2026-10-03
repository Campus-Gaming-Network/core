import assert from "node:assert/strict";
import test from "node:test";
import { createApiClient, type Fetcher } from "../src/server/api.server.js";
import {
  eventPeopleInput,
  validateEventPeopleSearch,
  validatePeopleSearch,
} from "../src/features/people-slice/contracts.js";
import {
  eventAttendeesOperation,
  schoolMembersOperation,
  teamMembersOperation,
} from "../src/features/people-slice/people-operations.server.js";
import {
  personDetail,
  verificationDetail,
} from "../src/features/people-slice/presentation.js";

const cookieHeader = "cgn_session=viewer-session";

const person = {
  id: "user-1",
  name: "Ada Player",
  verification_level: "verified",
  role_indicators: ["school_admin"],
};

// What the API sends for a person, plus fields that must never reach a page.
const apiPerson = {
  ...person,
  email: "ada@example.test",
  home_school_id: "school-1",
};

const apiList = {
  people: [apiPerson],
  limit: 24,
  has_more: true,
  has_previous: true,
  next_cursor: "next-cursor",
  previous_cursor: "previous-cursor",
  internal: "must-not-serialize",
};

const servedList = {
  people: [person],
  limit: 24,
  has_more: true,
  has_previous: true,
  next_cursor: "next-cursor",
  previous_cursor: "previous-cursor",
};

function client(fetcher: Fetcher) {
  return createApiClient({ baseUrl: "http://api:8080", fetcher });
}

test("event attendees are read with the viewer's session, the unlock proof, and encoded cursors", async () => {
  const calls: Array<{ init?: RequestInit; url: string }> = [];
  const result = await eventAttendeesOperation(
    { slug: "late/night lan", response: "maybe", after: "after+cursor" },
    {
      api: client(async (input, init) => {
        calls.push({ init, url: String(input) });
        return Response.json(apiList);
      }),
      cookieHeader,
      unlockHeaders: { "X-CGN-Event-Unlock": "unlock-token" },
    },
  );

  assert.deepEqual(
    calls.map(({ url }) => url),
    [
      "http://api:8080/events/late%2Fnight%20lan/attendees?response=maybe&limit=24&after=after%2Bcursor",
    ],
  );
  const headers = new Headers(calls[0]?.init?.headers);
  assert.deepEqual(
    {
      cookie: headers.get("cookie"),
      unlock: headers.get("x-cgn-event-unlock"),
      cache: calls[0]?.init?.cache,
    },
    { cookie: cookieHeader, unlock: "unlock-token", cache: "no-store" },
  );
  assert.deepEqual(result, { status: "found", list: servedList });
});

test("school and team lists use their own paths, a requested limit, and team roles", async () => {
  const urls: string[] = [];
  const api = client(async (input) => {
    urls.push(String(input));
    return Response.json({
      people: [{ ...apiPerson, role: "captain" }],
      limit: 8,
      has_more: false,
      has_previous: false,
    });
  });

  const school = await schoolMembersOperation(
    { slug: "example university", limit: 8, before: "earlier" },
    { api, cookieHeader },
  );
  const team = await teamMembersOperation(
    { slug: "varsity/rocket-league" },
    { api, cookieHeader },
  );

  assert.deepEqual(urls, [
    "http://api:8080/schools/example%20university/members?limit=8&before=earlier",
    "http://api:8080/teams/varsity%2Frocket-league/members?limit=24",
  ]);
  const captainList = {
    people: [{ ...person, role: "captain" }],
    limit: 8,
    has_more: false,
    has_previous: false,
  };
  assert.deepEqual(school, { status: "found", list: captainList });
  assert.deepEqual(team, { status: "found", list: captainList });
});

test("a request with no session is signed out without reaching the API", async () => {
  const api = client(async () => {
    throw new Error("the API must not be called");
  });

  assert.deepEqual(
    await eventAttendeesOperation(
      { slug: "lan", response: "yes" },
      { api, cookieHeader: "" },
    ),
    { status: "signed_out" },
  );
  assert.deepEqual(
    await schoolMembersOperation({ slug: "school" }, { api, cookieHeader: "" }),
    { status: "signed_out" },
  );
  assert.deepEqual(
    await teamMembersOperation({ slug: "team" }, { api, cookieHeader: "" }),
    { status: "signed_out" },
  );
});

test("a rejected session, a missing list, and an outage are told apart without leaking detail", async () => {
  const reported: unknown[] = [];
  const read = (fetcher: Fetcher) =>
    teamMembersOperation(
      { slug: "team" },
      {
        api: client(fetcher),
        cookieHeader,
        reportError: (error) => reported.push(error),
      },
    );

  assert.deepEqual(
    await read(async () =>
      Response.json({ error: "authentication_required" }, { status: 401 }),
    ),
    { status: "signed_out" },
  );
  assert.deepEqual(
    await read(async () =>
      Response.json({ error: "team_not_found" }, { status: 404 }),
    ),
    { status: "not_found" },
  );
  assert.deepEqual(reported, []);

  const unavailable = { status: "unavailable" };
  assert.deepEqual(
    await read(async () =>
      Response.json({ error: "database_unavailable" }, { status: 503 }),
    ),
    unavailable,
  );
  assert.deepEqual(
    await read(async () => Response.json({ people: "not a list" })),
    unavailable,
  );
  assert.deepEqual(
    await read(async () => {
      throw new Error("offline");
    }),
    unavailable,
  );
  assert.equal(reported.length, 3);
});

test("people search keeps one bounded cursor and only a known RSVP list", () => {
  assert.deepEqual(
    validateEventPeopleSearch({ response: "maybe", after: "a", before: "b" }),
    { response: "maybe", after: "a" },
  );
  assert.deepEqual(validateEventPeopleSearch({ response: "no", before: "b" }), {
    before: "b",
  });
  assert.deepEqual(
    validateEventPeopleSearch({
      response: ["maybe", "yes"],
      after: ["x", "y"],
    }),
    { response: "maybe", after: "x" },
  );
  assert.deepEqual(validatePeopleSearch({ after: "x".repeat(2049) }), {});
  assert.deepEqual(eventPeopleInput({}), { response: "yes" });
  assert.deepEqual(eventPeopleInput({ response: "maybe", before: "b" }), {
    response: "maybe",
    before: "b",
  });
});

test("a person's detail line is their team role in a team list and their verification elsewhere", () => {
  assert.equal(personDetail({ ...person, role: "captain" }), "Captain");
  assert.equal(personDetail(person), "Verified student · School admin");
  assert.equal(
    verificationDetail({
      verification_level: "staff_faculty",
      role_indicators: ["staff_faculty"],
    }),
    "Staff / faculty",
  );
});
