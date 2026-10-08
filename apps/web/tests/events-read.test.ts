import assert from "node:assert/strict";
import test from "node:test";
import {
  eventsBrowseInput,
  validateEventsSearch,
} from "../src/features/event-slice/contracts.js";
import {
  getEventsBrowseOperation,
  homeEventsOperation,
} from "../src/features/event-slice/event-operations.server.js";
import {
  eventFormatLabel,
  eventLifecycleLabel,
  eventLocation,
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
  host_school: {
    id: "school-1",
    name: "Example University",
    slug: "example",
  },
  games: [{ id: "game-1", name: "Example Game", slug: "example-game" }],
  rsvp_yes_count: 5,
  interest_count: 8,
  viewer_interested: true,
  viewer_can_edit: true,
  unlock_token: "must-not-cross-the-browse-boundary",
};

test("event search accepts bounded filters and opaque cursors without loading notices", () => {
  const search = validateEventsSearch({
    game: [" example-game ", "ignored"],
    school: " example-school ",
    format: "hybrid",
    audience: "open",
    type: "lan",
    after: " opaque+cursor== ",
    before: ["previous/cursor", "ignored"],
    event: "cancelled",
  });

  assert.deepEqual(search, {
    game: "example-game",
    school: "example-school",
    format: "hybrid",
    audience: "open",
    type: "lan",
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
    after: "opaque+cursor==",
    before: "previous/cursor",
  });

  assert.deepEqual(
    validateEventsSearch({
      format: "teleport",
      audience: "everyone",
      type: "bracket",
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
      after: "opaque+cursor==",
    },
    {
      api: client(async (input, init) => {
        const url = String(input);
        requests.push({ url, init });
        if (url.endsWith("/games")) {
          return Response.json({
            games: [
              {
                id: "game-1",
                name: "Example Game",
                slug: "example-game",
                internal_rank: 1,
              },
            ],
          });
        }
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

  assert.ok(
    requests.some(
      ({ url }) =>
        url ===
        "http://api:8080/events?game=example-game&school=example-school&format=hybrid&audience=open&type=lan&limit=25&after=opaque%2Bcursor%3D%3D",
    ),
  );
  assert.ok(requests.some(({ url }) => url === "http://api:8080/games"));
  for (const request of requests) {
    assert.equal(request.init?.cache, "no-store");
    assert.equal(new Headers(request.init?.headers).has("cookie"), false);
  }
  assert.equal(result.eventsUnavailable, false);
  assert.equal(result.gamesUnavailable, false);
  assert.equal(result.events[0]?.title, "Campus tournament");
  assert.equal(result.games[0]?.name, "Example Game");
  assert.equal(JSON.stringify(result).includes("unlock_token"), false);
  assert.equal(JSON.stringify(result).includes("viewer_interested"), false);
  assert.equal(JSON.stringify(result).includes("internal_rank"), false);
  assert.deepEqual(result.events[0]?.host_school, {
    name: "Example University",
  });
  assert.deepEqual(result.events[0]?.games, [{ name: "Example Game" }]);
});

test("event and game browse failures independently degrade to empty data", async () => {
  const reported: unknown[] = [];
  const eventFailure = await getEventsBrowseOperation(
    {},
    {
      api: client(async (input) =>
        String(input).endsWith("/games")
          ? Response.json({
              games: [
                { id: "game-1", name: "Example Game", slug: "example-game" },
              ],
            })
          : Response.json({ error: "database_unavailable" }, { status: 503 }),
      ),
      reportError: (error) => reported.push(error),
    },
  );
  assert.deepEqual(eventFailure.events, []);
  assert.equal(eventFailure.eventsUnavailable, true);
  assert.equal(eventFailure.games.length, 1);
  assert.equal(eventFailure.gamesUnavailable, false);

  const gameFailure = await getEventsBrowseOperation(
    {},
    {
      api: client(async (input) =>
        String(input).endsWith("/games")
          ? Response.json({ error: "database_unavailable" }, { status: 503 })
          : Response.json({
              events: [browseEvent],
              limit: 25,
              has_more: false,
              has_previous: false,
            }),
      ),
      reportError: (error) => reported.push(error),
    },
  );
  assert.equal(gameFailure.events.length, 1);
  assert.equal(gameFailure.eventsUnavailable, false);
  assert.deepEqual(gameFailure.games, []);
  assert.equal(gameFailure.gamesUnavailable, true);
  assert.equal(reported.length, 2);
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
  assert.equal(
    eventLocation(browseEvent),
    "Student Union · 100 Campus Drive + online",
  );
  assert.equal(safeExternalEventUrl("javascript:alert(1)"), undefined);
  assert.equal(
    safeExternalEventUrl("https://payments.example/path"),
    "https://payments.example/path",
  );
});

test("the home page previews the newest public events and strips private fields", async () => {
  const requested: string[] = [];
  const result = await homeEventsOperation({
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

  assert.deepEqual(requested, ["http://api:8080/events?limit=6"]);
  assert.equal(result.unavailable, false);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0]?.slug, "campus-tournament");
  assert.equal(JSON.stringify(result).includes("unlock_token"), false);
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

    assert.deepEqual(result, { events: [], unavailable: true });
  }
  assert.equal(reported.length, 3);
});
