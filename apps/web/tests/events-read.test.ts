import assert from "node:assert/strict";
import test from "node:test";
import {
  eventsBrowseInput,
  validateEventsSearch,
} from "../src/features/event-slice/contracts.js";
import {
  getEventsBrowseOperation,
  homeEventsOperation,
  teamEventsOperation,
} from "../src/features/event-slice/event-operations.server.js";
import {
  currentEventScope,
  eventScopeSearch,
} from "../src/features/event-slice/event-scope.js";
import {
  eventFormatLabel,
  eventLifecycleLabel,
  eventPlace,
  eventsHead,
  safeExternalEventUrl,
} from "../src/features/event-slice/presentation.js";
import { createApiClient, type Fetcher } from "../src/server/api.server.js";

function client(fetcher: Fetcher) {
  return createApiClient({ baseUrl: "http://api:8080", fetcher });
}

const browseEvent = {
  id: "event-1",
  title: "Campus tournament",
  slug: "campus-tournament",
  format: "hybrid" as const,
  starts_at: "2037-02-20T02:00:00Z",
  ends_at: "2037-02-20T05:00:00Z",
  timezone: "America/Los_Angeles",
  location_name: "Student Union",
  address: "100 Campus Drive",
  online_url: "https://example.test/room",
  lifecycle: "upcoming" as const,
  cost: "free" as const,
  host_school: {
    id: "school-1",
    name: "Example University",
    slug: "example",
  },
  games: [
    {
      id: "game-1",
      name: "Example Game",
      slug: "example-game",
      has_cover: true,
    },
  ],
  rsvp_yes_count: 5,
  interest_count: 8,
  viewer_interested: true,
  viewer_can_edit: true,
  unlock_token: "must-not-cross-the-browse-boundary",
};

test("event search accepts bounded filters, a school search, and opaque cursors without loading notices", () => {
  const search = validateEventsSearch({
    game: [" example-game ", "ignored"],
    school: " example-school ",
    school_q: " ohio state ",
    game_q: " rocket ",
    format: "hybrid",
    audience: "open",
    type: "lan",
    cost: "free",
    after: " opaque+cursor== ",
    before: ["previous/cursor", "ignored"],
    event: "cancelled",
  });

  assert.deepEqual(search, {
    game: "example-game",
    school: "example-school",
    school_q: "ohio state",
    game_q: "rocket",
    format: "hybrid",
    audience: "open",
    type: "lan",
    cost: "free",
    after: "opaque+cursor==",
    before: "previous/cursor",
    event: "cancelled",
  });
  assert.deepEqual(eventsBrowseInput(search), {
    game: "example-game",
    school: "example-school",
    format: "hybrid",
    audience: "open",
    type: "lan",
    cost: "free",
    after: "opaque+cursor==",
    before: "previous/cursor",
  });

  assert.deepEqual(
    validateEventsSearch({
      format: "teleport",
      audience: "everyone",
      type: "bracket",
      cost: "paid",
      after: "x".repeat(1025),
      event: "backend-message",
    }),
    {},
  );
});

test("event browse reads public no-store DTOs and strips viewer/private fields", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const result = await getEventsBrowseOperation(
    {
      game: "example-game",
      school: "example-school",
      format: "hybrid",
      audience: "open",
      type: "lan",
      cost: "free",
      after: "opaque+cursor==",
    },
    {
      api: client(async (input, init) => {
        const url = String(input);
        requests.push({ url, init });
        return Response.json({
          events: [browseEvent],
          limit: 25,
          has_more: true,
          has_previous: false,
          next_cursor: "next+cursor==",
        });
      }),
    },
  );

  // One request: the game catalog is never loaded whole for the directory.
  assert.deepEqual(
    requests.map(({ url }) => url),
    [
      "http://api:8080/events?game=example-game&school=example-school&format=hybrid&audience=open&type=lan&cost=free&limit=25&after=opaque%2Bcursor%3D%3D",
    ],
  );
  for (const request of requests) {
    assert.equal(request.init?.cache, "no-store");
    assert.equal(new Headers(request.init?.headers).has("cookie"), false);
  }
  assert.equal(result.eventsUnavailable, false);
  assert.equal(result.events[0]?.title, "Campus tournament");
  assert.equal(JSON.stringify(result).includes("unlock_token"), false);
  assert.equal(JSON.stringify(result).includes("viewer_interested"), false);
  assert.deepEqual(result.events[0]?.host_school, {
    name: "Example University",
    slug: "example",
  });
  assert.deepEqual(result.events[0]?.games, [
    { name: "Example Game", slug: "example-game", has_cover: true },
  ]);
});

test("event browse failure degrades to an unavailable empty list", async () => {
  const reported: unknown[] = [];
  const result = await getEventsBrowseOperation(
    {},
    {
      api: client(async () =>
        Response.json({ error: "database_unavailable" }, { status: 503 }),
      ),
      reportError: (error) => reported.push(error),
    },
  );
  assert.deepEqual(result, {
    events: [],
    limit: 25,
    has_more: false,
    has_previous: false,
    eventsUnavailable: true,
  });
  assert.equal(reported.length, 1);
});

test("event read presentation matches labels, notices, indexable head, and safe URLs", () => {
  const head = eventsHead("https://cgn.example");

  assert.deepEqual(head.meta[0], {
    title: "Events | Campus Gaming Network",
  });
  assert.ok(
    head.meta.some(
      (entry) =>
        entry.property === "og:url" &&
        entry.content === "https://cgn.example/events",
    ),
  );
  assert.equal(
    head.meta.some((entry) => entry.name === "robots"),
    false,
  );
  assert.equal(eventLifecycleLabel("happening_now"), "Happening now");
  assert.equal(eventFormatLabel("in_person"), "In person");
  const unlocated = {
    ...browseEvent,
    format: "in_person" as const,
    location_name: undefined,
    address: undefined,
  };
  // List rows name the place but leave the street address to the event page.
  assert.deepEqual(
    [
      eventPlace(browseEvent),
      eventPlace({ ...browseEvent, format: "in_person" }),
      eventPlace(unlocated),
    ],
    ["Student Union + online", "Student Union", undefined],
  );
  assert.equal(safeExternalEventUrl("javascript:alert(1)"), undefined);
  assert.equal(
    safeExternalEventUrl("https://payments.example/path"),
    "https://payments.example/path",
  );
});

test("the home page previews this week's events and the ones after it, split at the same minute", async () => {
  const requested: string[] = [];
  const result = await homeEventsOperation({
    now: () => new Date("2031-01-10T12:34:56.789Z"),
    api: client(async (input) => {
      requested.push(String(input));
      return Response.json({
        events: [browseEvent],
        limit: 6,
        has_more: true,
        has_previous: false,
        next_cursor: "opaque-cursor",
      });
    }),
  });

  assert.deepEqual(requested, [
    "http://api:8080/events?limit=6&starts_before=2031-01-17T12%3A34%3A00Z",
    "http://api:8080/events?limit=6&starts_after=2031-01-17T12%3A34%3A00Z",
  ]);
  assert.equal(result.unavailable, false);
  assert.deepEqual(
    [result.thisWeek, result.later].map((events) =>
      events.map((event) => event.slug),
    ),
    [["campus-tournament"], ["campus-tournament"]],
  );
  assert.equal(JSON.stringify(result).includes("unlock_token"), false);
});

test("a team page reads the events that team hosts, and survives a failure", async () => {
  const requested: string[] = [];
  const hosted = {
    ...browseEvent,
    host_team: { name: "Red Team", slug: "red/team" },
  };
  const found = await teamEventsOperation(
    { slug: "red/team" },
    {
      api: client(async (input) => {
        requested.push(String(input));
        return Response.json({
          events: [hosted],
          limit: 6,
          has_more: false,
          has_previous: false,
        });
      }),
    },
  );
  const reported: unknown[] = [];
  const failed = await teamEventsOperation(
    { slug: "red/team" },
    {
      api: client(async () =>
        Response.json({ error: "events_unavailable" }, { status: 503 }),
      ),
      reportError: (error) => reported.push(error),
    },
  );

  assert.deepEqual(requested, [
    "http://api:8080/events?limit=6&team=red%2Fteam",
  ]);
  assert.deepEqual(
    found.events.map((event) => [event.slug, event.host_team]),
    [["campus-tournament", { name: "Red Team", slug: "red/team" }]],
  );
  assert.deepEqual(
    { failed, reported: reported.length },
    { failed: { events: [], unavailable: true }, reported: 1 },
  );
});

test("a failed or malformed events read leaves the home page up and says so", async () => {
  const reported: unknown[] = [];
  for (const fetcher of [
    async () => {
      throw new Error("offline");
    },
    async () => Response.json({ error: "events_unavailable" }, { status: 503 }),
    async () => Response.json({ events: "not a list" }),
  ] as Fetcher[]) {
    // Sequential so each outcome is attributable to its own failure mode.
    // eslint-disable-next-line no-await-in-loop
    const result = await homeEventsOperation({
      api: client(fetcher),
      reportError: (error) => reported.push(error),
    });

    assert.deepEqual(result, { thisWeek: [], later: [], unavailable: true });
  }
  assert.equal(reported.length, 3);
});

test("only a tab's own scope selects it, never a filter alone", () => {
  const scopes = [
    {},
    { format: "online" },
    { type: "tournament" },
    { school: "summit-ridge" },
    { scope: "online", format: "online" },
    { scope: "online", format: "online", type: "lan" },
    { scope: "online", format: "in_person" },
    { scope: "tournaments", type: "tournament" },
    { scope: "tournaments" },
    { scope: "my-school", school: "summit-ridge" },
    { scope: "my-school", school: "other-school" },
    { scope: "unknown", format: "online" },
  ].map((query) =>
    currentEventScope(validateEventsSearch(query), "summit-ridge"),
  );

  assert.deepEqual(scopes, [
    "all",
    "all",
    "all",
    "all",
    "online",
    "online",
    "all",
    "tournaments",
    "all",
    "my-school",
    "all",
    "all",
  ]);
  assert.equal(
    currentEventScope(
      validateEventsSearch({ scope: "my-school", school: "summit-ridge" }),
      undefined,
    ),
    "all",
  );
});

test("a scope tab keeps the other filters, swaps the scope filter, and drops cursors", () => {
  const search = validateEventsSearch({
    game: "valorant",
    school: "other-school",
    format: "in_person",
    audience: "open",
    type: "lan",
    cost: "free",
    after: "cursor-after",
    event: "cancelled",
  });
  const links = (["all", "my-school", "online", "tournaments"] as const).map(
    (scope) => eventScopeSearch(search, scope, "summit-ridge"),
  );
  const kept = { game: "valorant", audience: "open", cost: "free" };

  assert.deepEqual(links, [
    kept,
    { ...kept, scope: "my-school", school: "summit-ridge" },
    { ...kept, scope: "online", format: "online" },
    { ...kept, scope: "tournaments", type: "tournament" },
  ]);
});
