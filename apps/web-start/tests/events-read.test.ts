import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import test from "node:test";
import {
  eventsBrowseInput,
  validateEventsSearch
} from "../src/features/event-slice/contracts.js";
import { getEventsBrowseOperation } from "../src/features/event-slice/event-operations.server.js";
import {
  eventFormatLabel,
  eventLifecycleLabel,
  eventLocation,
  eventNoticeMessage,
  eventsHead,
  safeExternalEventUrl
} from "../src/features/event-slice/presentation.js";
import { createApiClient, type Fetcher } from "../src/server/api.server.js";

const currentDirectory = process.cwd();
const appRoot =
  basename(currentDirectory) === "web-start"
    ? currentDirectory
    : join(currentDirectory, "apps/web-start");

function source(relativePath: string) {
  return readFileSync(join(appRoot, relativePath), "utf8");
}

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
    slug: "example"
  },
  games: [{ id: "game-1", name: "Example Game", slug: "example-game" }],
  viewer_interested: true,
  viewer_can_edit: true,
  unlock_token: "must-not-cross-the-browse-boundary"
};

test("event search accepts bounded filters and opaque cursors without loading notices", () => {
  const search = validateEventsSearch({
    game: [" example-game ", "ignored"],
    school: " example-school ",
    format: "hybrid",
    after: " opaque+cursor== ",
    before: ["previous/cursor", "ignored"],
    event: "cancelled"
  });

  assert.deepEqual(search, {
    game: "example-game",
    school: "example-school",
    format: "hybrid",
    after: "opaque+cursor==",
    before: "previous/cursor",
    event: "cancelled"
  });
  assert.deepEqual(eventsBrowseInput(search), {
    game: "example-game",
    school: "example-school",
    format: "hybrid",
    after: "opaque+cursor==",
    before: "previous/cursor"
  });

  assert.deepEqual(
    validateEventsSearch({
      format: "teleport",
      after: "x".repeat(1025),
      event: "backend-message"
    }),
    {}
  );
  assert.deepEqual(validateEventsSearch({ event: "report-submitted" }), {
    event: "report-submitted"
  });
});

test("event browse reads public no-store DTOs and strips viewer/private fields", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const result = await getEventsBrowseOperation(
    {
      game: "example-game",
      school: "example-school",
      format: "hybrid",
      after: "opaque+cursor=="
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
                internal_rank: 1
              }
            ]
          });
        }
        return Response.json({
          events: [browseEvent],
          limit: 25,
          has_more: true,
          has_previous: false,
          next_cursor: "next+cursor=="
        });
      })
    }
  );

  assert.ok(
    requests.some(
      ({ url }) =>
        url ===
        "http://api:8080/events?game=example-game&school=example-school&format=hybrid&limit=25&after=opaque%2Bcursor%3D%3D"
    )
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
    name: "Example University"
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
                { id: "game-1", name: "Example Game", slug: "example-game" }
              ]
            })
          : Response.json({ error: "database_unavailable" }, { status: 503 })
      ),
      reportError: (error) => reported.push(error)
    }
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
              has_previous: false
            })
      ),
      reportError: (error) => reported.push(error)
    }
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
    title: "Events | Campus Gaming Network"
  });
  assert.ok(
    head.meta.some(
      (entry) =>
        entry.property === "og:url" &&
        entry.content === "https://cgn.example/events"
    )
  );
  assert.equal(head.meta.some((entry) => entry.name === "robots"), false);
  assert.equal(eventLifecycleLabel("happening_now"), "Happening now");
  assert.equal(eventFormatLabel("in_person"), "In person");
  assert.equal(eventLocation(browseEvent), "Student Union · 100 Campus Drive + online");
  assert.equal(eventNoticeMessage("interest-added"), "Marked as interested.");
  assert.equal(
    eventNoticeMessage("report-submitted"),
    "Report submitted for review."
  );
  assert.equal(safeExternalEventUrl("javascript:alert(1)"), undefined);
  assert.equal(
    safeExternalEventUrl("https://payments.example/path"),
    "https://payments.example/path"
  );
});

test("browse and detail routes keep strict viewer and typed event write surfaces", () => {
  const browse = source("src/routes/events.index.tsx");
  const detail = source("src/routes/events.$slug.tsx");

  assert.match(browse, /loaderDeps: \(\{ search \}\) => eventsBrowseInput\(search\)/);
  assert.doesNotMatch(
    browse.match(/loaderDeps:[^\n]+/)?.[0] ?? "",
    /search\.event/
  );
  assert.match(browse, /getEventViewerSession\(\)/);
  assert.match(browse, /session\.status === "unavailable"/);
  assert.match(browse, /<RoutePending message="Loading events…"/);
  assert.match(browse, /to="\/events\/\$slug"/);
  assert.match(browse, /to="\/events\/new"/);
  assert.match(browse, /search=\{\{ next: "\/events\/new" \}\}/);

  assert.match(detail, /<EventBanner locked size="hero"/);
  assert.match(detail, /<EventBanner event=\{event\} size="hero"/);
  assert.match(detail, /to="\/events"/);
  assert.match(detail, /to="\/schools\/\$slug"/);
  assert.match(detail, /to="\/users\/\$id"/);
  assert.match(detail, /safeExternalEventUrl\(event\.payment_url\)/);
  assert.match(detail, /InterestEventForm event=\{event\}/);
  assert.match(detail, /CancelEventForm slug=\{event\.slug\}/);
  assert.match(detail, /ReportEventForm slug=\{event\.slug\}/);
  assert.match(detail, /to="\/events\/\$slug\/edit"/);
  assert.doesNotMatch(detail, /eventInterestAction|deleteEventAction/);
});
