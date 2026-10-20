import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { getNavigationSessionOperation } from "../src/features/event-slice/auth-operations.server.js";
import {
  validateInboxSearch,
  validateMarkReadInput,
} from "../src/features/notifications/contracts.js";
import {
  inboxOperation,
  markAllReadOperation,
  markReadOperation,
} from "../src/features/notifications/notifications-operations.server.js";
import { createApiClient, type Fetcher } from "../src/server/api.server.js";
import { requestURL } from "./fetch-stub.js";

const notificationID = "77777777-7777-4777-8777-777777777777";
const profile = {
  id: "user-1",
  public_id: "Ab3dEf5hJk",
  email: "player@example.com",
  verification_level: "basic",
  name: "Player One",
  timezone: "America/Chicago",
  home_school_id: "school-1",
};
const notification = {
  id: notificationID,
  type: "event.cancelled",
  title: "Event cancelled",
  body: "Chess Night was cancelled by its organizer.",
  event_slug: "chess-night",
  created_at: "2026-10-17T17:30:00Z",
};

function client(fetcher: Fetcher) {
  return createApiClient({ baseUrl: "http://api:8080", fetcher });
}

function routed(routes: Record<string, () => Response>): Fetcher {
  return async (input) => {
    const url = new URL(requestURL(input));
    const route = routes[url.pathname + url.search];
    if (!route) throw new Error(`unexpected request ${url.pathname}`);
    return route();
  };
}

test("the inbox shows each notice in the viewer's own time zone", async () => {
  const dependencies = {
    cookieHeader: "cgn_session=value",
    sessionCookieValue: "value",
    reportError: () => {},
  };
  const ready = await inboxOperation(
    { after: "cursor-1" },
    {
      ...dependencies,
      api: client(
        routed({
          "/me": () => Response.json(profile),
          "/me/notifications?after=cursor-1": () =>
            Response.json({
              notifications: [{ ...notification, internal: "strip" }],
              next_cursor: "cursor-2",
            }),
        }),
      ),
    },
  );
  const unavailable = await inboxOperation(
    {},
    {
      ...dependencies,
      api: client(
        routed({
          "/me": () => Response.json(profile),
          "/me/notifications": () =>
            Response.json(
              { error: "notifications_unavailable" },
              { status: 500 },
            ),
        }),
      ),
    },
  );
  const signedOut = await inboxOperation(
    {},
    {
      ...dependencies,
      api: client(async () =>
        Response.json({ error: "authentication_required" }, { status: 401 }),
      ),
    },
  );

  assert.deepEqual(
    [ready, unavailable, signedOut],
    [
      {
        status: "ready",
        entries: [{ ...notification, createdLabel: "Oct 17, 2026, 12:30 PM" }],
        nextCursor: "cursor-2",
      },
      { status: "unavailable" },
      { status: "unauthenticated" },
    ],
  );
});

test("opening a notice marks it read and goes to its event; marking all returns to the inbox", async () => {
  const calls: Array<{ method?: string; url: string }> = [];
  const api = client(async (input, init) => {
    calls.push({ method: init?.method, url: requestURL(input) });
    return requestURL(input).endsWith("/read-all")
      ? Response.json({ marked: 2 })
      : Response.json({ ...notification, read_at: "2026-10-17T18:00:00Z" });
  });
  const failing = client(async () =>
    Response.json({ error: "notification_not_found" }, { status: 404 }),
  );
  const dependencies = { api, cookieHeader: "cgn_session=value" };

  const results = [
    await markReadOperation(
      { notification_id: notificationID, event_slug: "chess-night" },
      dependencies,
    ),
    await markReadOperation({ notification_id: notificationID }, dependencies),
    await markAllReadOperation(dependencies),
    await markReadOperation(
      { notification_id: notificationID },
      { api: failing, cookieHeader: "", reportError: () => {} },
    ),
  ];

  assert.deepEqual(
    { calls, redirects: results.map((result) => result.redirectTo) },
    {
      calls: [
        {
          method: "POST",
          url: `http://api:8080/me/notifications/${notificationID}/read`,
        },
        {
          method: "POST",
          url: `http://api:8080/me/notifications/${notificationID}/read`,
        },
        { method: "POST", url: "http://api:8080/me/notifications/read-all" },
      ],
      redirects: [
        "/events/chess-night",
        "/notifications",
        "/notifications?notice=all-read",
        "/notifications?notice=failed",
      ],
    },
  );
});

test("the header carries the unread count, and leaves it out when it cannot be read", async () => {
  const session = (count: () => Response) =>
    getNavigationSessionOperation({
      api: client(
        routed({
          "/me": () => Response.json(profile),
          "/me/notifications/unread-count": count,
        }),
      ),
      cookieHeader: "cgn_session=value",
      sessionCookieValue: "value",
    });

  assert.deepEqual(
    [
      await session(() => Response.json({ unread: 4 })),
      await session(() => Response.json({ error: "down" }, { status: 503 })),
    ],
    [
      {
        authenticated: true,
        user: {
          id: "user-1",
          publicId: "Ab3dEf5hJk",
          name: "Player One",
          unreadNotifications: 4,
        },
      },
      {
        authenticated: true,
        user: { id: "user-1", publicId: "Ab3dEf5hJk", name: "Player One" },
      },
    ],
  );
});

test("inbox forms and searches keep only known values", () => {
  const open = new FormData();
  open.set("notification_id", notificationID);
  open.set("event_slug", " chess-night ");

  assert.deepEqual(
    [
      validateMarkReadInput(open),
      validateMarkReadInput({ notification_id: notificationID }),
      validateMarkReadInput({ notification_id: "nope" }),
      validateInboxSearch({ after: "cursor", notice: "all-read" }),
      validateInboxSearch({ after: "", notice: "other" }),
    ],
    [
      { notification_id: notificationID, event_slug: "chess-night" },
      { notification_id: notificationID },
      undefined,
      { after: "cursor", notice: "all-read" },
      {},
    ],
  );
});
