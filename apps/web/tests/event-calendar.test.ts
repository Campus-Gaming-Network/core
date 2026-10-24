import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { test } from "vite-plus/test";
import {
  eventDtoSchema,
  type EventDTO,
} from "../src/features/event-slice/contracts.js";
import {
  eventCalendarResponse,
  eventICS,
} from "../src/features/event-slice/event-calendar.server.js";
import { createApiClient, type Fetcher } from "../src/server/api.server.js";
import { requestURL } from "./fetch-stub.js";

const currentDirectory = process.cwd();
const appRoot =
  basename(currentDirectory) === "web"
    ? currentDirectory
    : join(currentDirectory, "apps/web");

const now = new Date("2037-01-01T00:00:00Z");

const event: EventDTO = {
  id: "7c1e2f3a-0000-4000-8000-000000000001",
  title: "Smash; Rocket, League\\Night",
  slug: "smash-night",
  description: "Bring a\r\ncontroller\\\u0007.",
  visibility: "public",
  format: "hybrid",
  audience: "campus",
  starts_at: "2037-02-19T18:00:00-08:00",
  ends_at: "2037-02-20T05:00:00Z",
  timezone: "America/Los_Angeles",
  location_name: "Union",
  address: "1 Main St",
  online_url: "https://x.test/r",
  rsvp_yes_count: 0,
  interest_count: 0,
  lifecycle: "upcoming",
  cost: "unspecified",
  host_school: { id: "school-1", name: "Example University", slug: "example" },
  games: [],
  revision: 0,
  updated_at: "2036-12-20T00:00:00Z",
};

function client(fetcher: Fetcher) {
  return createApiClient({ baseUrl: "http://api:8080", fetcher });
}

function locationLines(overrides: Partial<EventDTO>) {
  return eventICS({ ...event, ...overrides }, "https://cgn.test/e", now)
    .split("\r\n")
    .filter((line) => line.startsWith("LOCATION"));
}

test("an event becomes one escaped UTC VCALENDAR entry", () => {
  assert.equal(
    eventICS(event, "https://cgn.test/e", now),
    [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Campus Gaming Network//CGN//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "BEGIN:VEVENT",
      "UID:7c1e2f3a-0000-4000-8000-000000000001@campusgamingnetwork.com",
      "DTSTAMP:20370101T000000Z",
      "DTSTART:20370220T020000Z",
      "DTEND:20370220T050000Z",
      "LAST-MODIFIED:20361220T000000Z",
      "SEQUENCE:0",
      "STATUS:CONFIRMED",
      "TRANSP:OPAQUE",
      "SUMMARY:Smash\\; Rocket\\, League\\\\Night",
      "DESCRIPTION:Bring a\\ncontroller\\\\.\\n\\nWho it's for: Host campus only\\n\\nVie",
      " w event: https://cgn.test/e",
      "LOCATION:Union\\, 1 Main St + Online: https://x.test/r",
      "URL:https://cgn.test/e",
      "END:VEVENT",
      "END:VCALENDAR",
      "",
    ].join("\r\n"),
  );
});

// The Go RSVP attachment renders the same fixtures to the same files, so a
// file from either replaces the other in a calendar: editing raises
// SEQUENCE, and cancelling raises it again and marks the event cancelled.
test("the export matches the calendar fixtures the RSVP attachment shares", () => {
  const fixtures = join(appRoot, "../api/internal/events/testdata/calendar");
  const read = (name: string) => readFileSync(join(fixtures, name), "utf8");
  const rendered = ["created", "edited", "cancelled"].map((state) => {
    const fixture = eventDtoSchema.parse(JSON.parse(read(`${state}.json`)));
    return eventICS(
      fixture,
      `https://cgn.test/events/${fixture.slug}`,
      new Date("2037-02-01T12:00:00Z"),
    );
  });

  assert.deepEqual(rendered, [
    read("created.ics"),
    read("edited.ics"),
    read("cancelled.ics"),
  ]);
});

test("a cancelled event is marked cancelled with a higher sequence", () => {
  const body = eventICS(
    {
      ...event,
      title: "Café Night 🎮",
      description: "",
      format: "in_person",
      location_name: undefined,
      address: undefined,
      audience: undefined,
      cancelled_at: "2037-01-02T03:04:05Z",
      revision: 1,
      updated_at: "2037-01-02T03:04:05Z",
    },
    "https://cgn.test/e",
    now,
  );

  assert.equal(
    body,
    [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Campus Gaming Network//CGN//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "BEGIN:VEVENT",
      "UID:7c1e2f3a-0000-4000-8000-000000000001@campusgamingnetwork.com",
      "DTSTAMP:20370101T000000Z",
      "DTSTART:20370220T020000Z",
      "DTEND:20370220T050000Z",
      "LAST-MODIFIED:20370102T030405Z",
      "SEQUENCE:1",
      "STATUS:CANCELLED",
      "TRANSP:OPAQUE",
      "SUMMARY:Café Night 🎮",
      "DESCRIPTION:View event: https://cgn.test/e",
      "URL:https://cgn.test/e",
      "END:VEVENT",
      "END:VCALENDAR",
      "",
    ].join("\r\n"),
  );
});

test("folded accented and emoji text stays within 75 octets per line", () => {
  const title = "É".repeat(40) + "🎮".repeat(20);
  const lines = eventICS({ ...event, title }, "https://cgn.test/e", now).split(
    "\r\n",
  );
  const start = lines.findIndex((line) => line.startsWith("SUMMARY:"));
  const end = lines.findIndex((line) => line.startsWith("DESCRIPTION:"));

  assert.deepEqual(lines.slice(start, end), [
    `SUMMARY:${"É".repeat(33)}`,
    ` ${"É".repeat(7)}${"🎮".repeat(15)}`,
    ` ${"🎮".repeat(5)}`,
  ]);
});

test("a unicode title gets an ASCII fallback and a filename* form", async () => {
  const dependencies = {
    api: client(async () =>
      Response.json({ ...event, title: 'Café "Night" 🎮 100%' }),
    ),
    publicOrigin: "https://cgn.test",
    now: () => now,
  };
  const response = await eventCalendarResponse(
    new Request("https://web.test/api/events/smash-night/calendar.ics"),
    "smash-night",
    dependencies,
  );
  const emoji = await eventCalendarResponse(
    new Request("https://web.test/api/events/smash-night/calendar.ics"),
    "smash-night",
    {
      ...dependencies,
      api: client(async () => Response.json({ ...event, title: "🎮🎮" })),
    },
  );

  assert.deepEqual(
    [
      response.headers.get("content-disposition"),
      emoji.headers.get("content-disposition"),
    ],
    [
      "inline; filename=\"Cafe_Night_100.ics\"; filename*=UTF-8''Caf%C3%A9%20%20Night%20%20%F0%9F%8E%AE%20100%25.ics",
      "inline; filename=\"smash-night.ics\"; filename*=UTF-8''%F0%9F%8E%AE%F0%9F%8E%AE.ics",
    ],
  );
});

test("an event across the November 2026 fall-back keeps its UTC instants", () => {
  const lines = eventICS(
    {
      ...event,
      starts_at: "2026-11-01T05:30:00Z",
      ends_at: "2026-11-01T07:30:00Z",
      timezone: "America/New_York",
    },
    "https://cgn.test/e",
    now,
  ).split("\r\n");

  assert.deepEqual(
    lines.filter((line) => /^DT(START|END)/.test(line)),
    ["DTSTART:20261101T053000Z", "DTEND:20261101T073000Z"],
  );
});

test("the location follows the event format and is left out when empty", () => {
  assert.deepEqual(
    [
      locationLines({ format: "online" }),
      locationLines({ format: "online", online_url: undefined }),
      locationLines({ format: "in_person" }),
      locationLines({
        format: "in_person",
        location_name: undefined,
        address: undefined,
      }),
      locationLines({
        format: "hybrid",
        location_name: undefined,
        address: undefined,
        online_url: undefined,
      }),
    ],
    [
      ["LOCATION:Online: https://x.test/r"],
      ["LOCATION:Online"],
      ["LOCATION:Union\\, 1 Main St"],
      [],
      ["LOCATION:Hybrid"],
    ],
  );
});

test("long lines fold at 75 octets without splitting a character", () => {
  const lines = eventICS(
    { ...event, title: `${"a".repeat(66)}🎮${"b".repeat(100)}` },
    "https://cgn.test/e",
    now,
  ).split("\r\n");
  const start = lines.findIndex((line) => line.startsWith("SUMMARY:"));
  const end = lines.findIndex((line) => line.startsWith("DESCRIPTION:"));

  assert.deepEqual(lines.slice(start, end), [
    `SUMMARY:${"a".repeat(66)}`,
    ` 🎮${"b".repeat(70)}`,
    ` ${"b".repeat(30)}`,
  ]);
});

test("an event request carries only the session and unlock cookies upstream", async () => {
  const requests: Array<{
    url: string;
    cookie: string | null;
    unlock: string | null;
  }> = [];
  const dependencies = {
    api: client(async (input, init) => {
      const headers = new Headers(init?.headers);
      requests.push({
        url: requestURL(input),
        cookie: headers.get("cookie"),
        unlock: headers.get("x-cgn-event-unlock"),
      });
      return Response.json({ ...event, unlock_token: "never-in-the-file" });
    }),
    publicOrigin: "https://cgn.test",
    now: () => now,
  };
  const headers = {
    cookie:
      "theme=dark; cgn_session=session-token; cgn_event_unlock_smash-night=unlock-token",
  };
  const url = "https://web.test/api/events/smash-night/calendar.ics";
  const expectedHeaders = {
    "cache-control": "private, no-store",
    "content-disposition": `inline; filename="Smash_Rocket_League_Night.ics"; filename*=UTF-8''Smash%3B%20Rocket%2C%20League%20Night.ics`,
    "content-type": "text/calendar; charset=utf-8",
    vary: "Cookie",
    "x-content-type-options": "nosniff",
    "x-robots-tag": "noindex, nofollow",
  };

  const get = await eventCalendarResponse(
    new Request(url, { headers }),
    "smash-night",
    dependencies,
  );
  const head = await eventCalendarResponse(
    new Request(url, { headers, method: "HEAD" }),
    "smash-night",
    dependencies,
  );

  assert.deepEqual(
    {
      status: get.status,
      headers: Object.fromEntries(get.headers),
      body: await get.text(),
    },
    {
      status: 200,
      headers: expectedHeaders,
      body: eventICS(event, "https://cgn.test/events/smash-night", now),
    },
  );
  assert.deepEqual(
    {
      status: head.status,
      headers: Object.fromEntries(head.headers),
      body: await head.text(),
    },
    { status: 200, headers: expectedHeaders, body: "" },
  );
  assert.deepEqual(requests, [
    {
      url: "http://api:8080/events/smash-night",
      cookie: "cgn_session=session-token",
      unlock: "unlock-token",
    },
    {
      url: "http://api:8080/events/smash-night",
      cookie: "cgn_session=session-token",
      unlock: "unlock-token",
    },
  ]);
});

test("locked, missing, and unavailable events never produce a calendar", async () => {
  const reported: unknown[] = [];
  let upstreamCalls = 0;
  const upstream: Record<string, () => Response> = {
    locked: () =>
      Response.json({
        slug: "locked",
        visibility: "private",
        locked: true,
        title: "Hidden title",
      }),
    missing: () => Response.json({ error: "event_not_found" }, { status: 404 }),
    unavailable: () =>
      Response.json({ error: "event_unavailable" }, { status: 500 }),
  };
  const dependencies = {
    api: client(async (input) => {
      upstreamCalls += 1;
      const slug = requestURL(input).split("/").pop() ?? "";
      return upstream[slug]!();
    }),
    publicOrigin: "https://cgn.test",
    now: () => now,
    reportError: (error: unknown) => reported.push(error),
  };

  const results = await Promise.all(
    ["locked", "missing", "unavailable", "", "x".repeat(201)].map(
      async (slug) => {
        const response = await eventCalendarResponse(
          new Request(`https://web.test/api/events/${slug}/calendar.ics`),
          slug,
          dependencies,
        );
        return {
          status: response.status,
          cacheControl: response.headers.get("cache-control"),
          body: await response.text(),
        };
      },
    ),
  );

  assert.deepEqual(
    results,
    [404, 404, 503, 404, 404].map((status) => ({
      status,
      cacheControl: "private, no-store",
      body: "",
    })),
  );
  assert.equal(upstreamCalls, 3);
  assert.equal(reported.length, 1);
});

test("the calendar route answers GET and HEAD and refuses other methods", () => {
  const route = readFileSync(
    join(appRoot, "src/routes/api.events.$slug.calendar[.]ics.ts"),
    "utf8",
  );

  assert.match(
    route,
    /createFileRoute\("\/api\/events\/\$slug\/calendar\.ics"\)/,
  );
  assert.match(
    route,
    /GET: \(\{ request, params \}\) => handleCalendarRequest\(request, params\.slug\)/,
  );
  assert.match(
    route,
    /HEAD: \(\{ request, params \}\) =>\s+handleCalendarRequest\(request, params\.slug\)/,
  );
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
    assert.match(route, new RegExp(`${method}: methodNotAllowedResponse`));
  }
});
