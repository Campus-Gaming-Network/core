import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vite-plus/test";
import { eventActivityOperation } from "../src/features/event-activity/activity-operations.server.js";
import { getEventActivity } from "../src/features/event-activity/activity.functions.js";
import type { EventActivityEntry } from "../src/features/event-activity/contracts.js";
import { eventActivityLine } from "../src/features/event-activity/presentation.js";
import { getEventDetail } from "../src/features/event-slice/event.functions.js";
import { Route } from "../src/routes/events.$slug_.activity.js";
import { createApiClient, type Fetcher } from "../src/server/api.server.js";
import { requestURL } from "./fetch-stub.js";
import { routeEvent } from "./route-fixtures.js";
import { loadRoute } from "./route-test.js";

vi.mock("../src/features/event-activity/activity.functions.js", () => ({
  getEventActivity: vi.fn(),
}));
vi.mock("../src/features/event-slice/event.functions.js", () => ({
  getEventDetail: vi.fn(),
}));

beforeEach(() => vi.clearAllMocks());

function client(fetcher: Fetcher) {
  return createApiClient({ baseUrl: "http://api:8080", fetcher });
}

const edit: EventActivityEntry = {
  id: "entry-2",
  action: "event.updated",
  occurred_at: "2037-02-10T18:30:00Z",
  visibility: "public",
  changes: [
    { field: "title", before: "Campus night", after: "Private campus night" },
    {
      field: "starts_at",
      before: "2037-02-20T01:00:00Z",
      after: "2037-02-20T02:00:00Z",
    },
    { field: "online_url" },
    { field: "games", before: [], after: [{ name: "Chess", slug: "chess" }] },
    { field: "capacity", before: null, after: 20 },
  ],
};
const created: EventActivityEntry = {
  id: "entry-1",
  action: "event.created",
  occurred_at: "2037-02-01T17:00:00Z",
  visibility: "editors",
  changes: [],
};

test("an entry reads in words, in the event's time zone, with its author only for editors", () => {
  const timeZone = routeEvent.timezone;
  assert.deepEqual(
    [
      eventActivityLine(
        { ...edit, actor: { name: "Jo", public_id: "public-jo" } },
        timeZone,
      ),
      eventActivityLine({ ...created, actor: null }, timeZone),
      eventActivityLine(edit, timeZone),
    ],
    [
      {
        summary: "Details changed",
        details: [
          "Title changed from “Campus night” to “Private campus night”",
          "Start moved from Feb 19, 2037, 5:00 PM PST to Feb 19, 2037, 6:00 PM PST",
          "Online link changed",
          "Games added: Chess",
          "Capacity changed from no limit to 20",
        ],
        author: "Jo",
        when: "Feb 10, 2037, 10:30 AM PST",
      },
      {
        summary: "Event created",
        details: [],
        author: "Deleted account",
        when: "Feb 1, 2037, 9:00 AM PST",
      },
      {
        summary: "Details changed",
        details: [
          "Title changed from “Campus night” to “Private campus night”",
          "Start moved from Feb 19, 2037, 5:00 PM PST to Feb 19, 2037, 6:00 PM PST",
          "Online link changed",
          "Games added: Chess",
          "Capacity changed from no limit to 20",
        ],
        when: "Feb 10, 2037, 10:30 AM PST",
      },
    ],
  );
});

test("the activity read forwards the session and unlock, and maps 404 and failures", async () => {
  const requests: Array<{
    url: string;
    cookie: string | null;
    unlock: string | null;
  }> = [];
  const found = await eventActivityOperation(
    { slug: "campus/night", limit: 3, after: "cursor-a" },
    {
      api: client(async (input, init) => {
        const headers = new Headers(init?.headers);
        requests.push({
          url: requestURL(input),
          cookie: headers.get("cookie"),
          unlock: headers.get("x-cgn-event-unlock"),
        });
        return Response.json({
          entries: [{ ...created, internal: "strip" }],
          next_cursor: "cursor-b",
        });
      }),
      cookieHeader: "cgn_session=value",
      unlockHeaders: { "X-CGN-Event-Unlock": "unlock-token" },
    },
  );
  const reported: unknown[] = [];
  const missing = await eventActivityOperation(
    { slug: "gone", limit: 3 },
    {
      api: client(async () =>
        Response.json({ error: "event_not_found" }, { status: 404 }),
      ),
      cookieHeader: "",
      reportError: (error) => reported.push(error),
    },
  );
  const failed = await eventActivityOperation(
    { slug: "campus-night", limit: 3 },
    {
      api: client(async () =>
        Response.json({ error: "event_unavailable" }, { status: 500 }),
      ),
      cookieHeader: "",
      reportError: (error) => reported.push(error),
    },
  );

  assert.deepEqual(
    { requests, found, missing, failed, reported: reported.length },
    {
      requests: [
        {
          url: "http://api:8080/events/campus%2Fnight/activity?limit=3&after=cursor-a",
          cookie: "cgn_session=value",
          unlock: "unlock-token",
        },
      ],
      found: {
        status: "found",
        page: { entries: [created], next_cursor: "cursor-b" },
      },
      missing: { status: "not_found" },
      failed: { status: "unavailable" },
      reported: 1,
    },
  );
});

async function renderLog(
  entries: EventActivityEntry[],
  href = "/events/campus-night/activity",
  nextCursor?: string,
) {
  vi.mocked(getEventActivity).mockResolvedValue({
    status: "found",
    page: { entries, ...(nextCursor ? { next_cursor: nextCursor } : {}) },
  });
  vi.mocked(getEventDetail).mockResolvedValue({
    status: "found",
    event: routeEvent,
  });
  return loadRoute(Route, "/events/$slug/activity", href);
}

test("an editor's log names who made each change, and an older page links back", async () => {
  const { match, render } = await renderLog(
    [
      { ...edit, actor: { name: "Jo Organizer", public_id: "public-jo" } },
      { ...created, actor: null },
    ],
    "/events/campus-night/activity?after=cursor-a",
    "cursor-b",
  );
  const markup = render();

  assert.deepEqual(vi.mocked(getEventActivity).mock.calls, [
    [{ data: { slug: "campus-night", limit: 20, after: "cursor-a" } }],
  ]);
  assert.match(markup, /Details changed<\/strong> by <!-- -->Jo Organizer/);
  assert.match(markup, /Event created<\/strong> by <!-- -->Deleted account/);
  assert.match(markup, /Games added: Chess/);
  assert.match(markup, /href="\/events\/campus-night\/activity"[^>]*>.*Newest/);
  assert.match(
    markup,
    /href="\/events\/campus-night\/activity\?after=cursor-b"/,
  );
  const meta = match?.meta;
  assert.ok(Array.isArray(meta));
  assert.ok(
    meta.some(
      (tag) => tag?.name === "robots" && tag.content === "noindex,nofollow",
    ),
  );
});

test("anyone else's log shows the public changes without an author", async () => {
  const markup = (await renderLog([edit])).render();
  assert.match(
    markup,
    /Title changed from “Campus night” to “Private campus night”/,
  );
  assert.doesNotMatch(markup, /<\/strong> by /);
  assert.doesNotMatch(markup, /Older|Newest/);
});

test("an event with no updates says so, and a log that is not found is a 404", async () => {
  const empty = (await renderLog([])).render();
  assert.match(empty, /No updates yet\./);

  vi.mocked(getEventActivity).mockResolvedValue({ status: "not_found" });
  const { response } = await loadRoute(
    Route,
    "/events/$slug/activity",
    "/events/locked/activity",
  );
  assert.deepEqual(
    response?.type === "render"
      ? { type: response.type, status: response.status }
      : response,
    { type: "render", status: 404 },
  );
  assert.equal(vi.mocked(getEventDetail).mock.calls.length, 1);
});
