import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vite-plus/test";
import { getEventViewerSession } from "../src/features/event-slice/auth.functions.js";
import type { EventDTO } from "../src/features/event-slice/contracts.js";
import { getEventDetail } from "../src/features/event-slice/event.functions.js";
import { getEventActivity } from "../src/features/event-activity/activity.functions.js";
import { getEventAttendees } from "../src/features/people-slice/people.functions.js";
import type {
  TournamentDTO,
  TournamentEntryDTO,
} from "../src/features/tournament-registration/contracts.js";
import {
  bracketHost,
  registrationState,
} from "../src/features/tournament-registration/presentation.js";
import {
  getRegistrationTeams,
  getTournamentEntries,
} from "../src/features/tournament-registration/tournament.functions.js";
import {
  deleteEntryOperation,
  registerOperation,
  tournamentEntriesOperation,
} from "../src/features/tournament-registration/tournament-operations.server.js";
import { Route } from "../src/routes/events.$slug.js";
import { createApiClient, type Fetcher } from "../src/server/api.server.js";
import { requestURL } from "./fetch-stub.js";
import { routeEvent } from "./route-fixtures.js";
import { loadRoute } from "./route-test.js";

vi.mock("../src/features/event-slice/auth.functions.js", () => ({
  getEventViewerSession: vi.fn(),
}));
vi.mock("../src/features/event-slice/event.functions.js", () => ({
  getEventDetail: vi.fn(),
  cancelEvent: { url: "/test/cancel" },
  reportEvent: { url: "/test/report" },
  rsvpEvent: { url: "/test/rsvp" },
  setEventInterest: { url: "/test/interest" },
  unlockEvent: { url: "/test/unlock" },
}));
vi.mock("../src/features/event-activity/activity.functions.js", () => ({
  getEventActivity: vi.fn(),
}));
vi.mock("../src/features/people-slice/people.functions.js", () => ({
  getEventAttendees: vi.fn(),
}));
vi.mock(
  "../src/features/tournament-registration/tournament.functions.js",
  () => ({
    getTournamentEntries: vi.fn(),
    getRegistrationTeams: vi.fn(),
    registerForTournament: { url: "/test/register" },
    withdrawTournamentEntry: { url: "/test/withdraw" },
    removeTournamentEntry: { url: "/test/remove" },
  }),
);

beforeEach(() => vi.clearAllMocks());

const entryID = "33333333-3333-4333-8333-333333333333";
const openSolo: TournamentDTO = {
  game: { id: "game-1", name: "Chess", slug: "chess" },
  entry_type: "solo",
  substitutes: 0,
  entrant_cap: 8,
  format: "single_elimination",
  rules: "",
  prizes: "",
  status: "registration_open",
  entry_count: 2,
};
const tournamentEvent: EventDTO = {
  ...routeEvent,
  visibility: "public",
  event_type: "tournament",
  tournament: openSolo,
};
const soloEntries: TournamentEntryDTO[] = [
  { id: entryID, seed: 1, registered_at: "2037-02-01T17:00:00Z" },
  {
    id: "44444444-4444-4444-8444-444444444444",
    seed: 2,
    player: { public_id: "public-ada", name: "Ada" },
    registered_at: "2037-02-02T17:00:00Z",
  },
];

async function renderEvent(
  event: EventDTO,
  authenticated: boolean,
  href = "/events/campus-night",
) {
  vi.mocked(getEventViewerSession).mockResolvedValue(
    authenticated
      ? { status: "authenticated", authenticated: true, hasSessionCookie: true }
      : {
          status: "unauthenticated",
          authenticated: false,
          hasSessionCookie: false,
        },
  );
  vi.mocked(getEventDetail).mockResolvedValue({ status: "found", event });
  vi.mocked(getEventActivity).mockResolvedValue({ status: "unavailable" });
  vi.mocked(getTournamentEntries).mockResolvedValue({
    status: "ready",
    items: soloEntries,
  });
  vi.mocked(getRegistrationTeams).mockResolvedValue({
    status: "ready",
    items: [
      {
        id: "team-1",
        name: "Knights",
        slug: "knights",
        entered: false,
        members: [
          { public_id: "public-ada", name: "Ada" },
          { public_id: "public-bo", name: "Bo" },
        ],
      },
    ],
  });
  return (await loadRoute(Route, "/events/$slug", href)).render();
}

test("the panel's state follows the status, the close time, the cap, and the viewer", () => {
  const now = new Date("2037-02-19T18:00:00Z");
  const startsAt = "2037-02-20T02:00:00Z";
  const state = (tournament: TournamentDTO, authenticated = true) =>
    registrationState(tournament, { authenticated, now, startsAt });
  assert.deepEqual(
    [
      state(openSolo),
      state(openSolo, false),
      state({ ...openSolo, entry_count: 8 }),
      state({ ...openSolo, registration_closes_at: "2037-02-19T17:00:00Z" }),
      state({ ...openSolo, registration_closes_at: "2037-02-21T00:00:00Z" }),
      state({ ...openSolo, status: "draft" }),
      state({ ...openSolo, status: "in_progress" }),
      state({
        ...openSolo,
        status: "in_progress",
        viewer_entry: { id: entryID, can_manage: true },
      }),
    ],
    [
      "open",
      "signed-out",
      "full",
      "closed",
      "open",
      "not-open",
      "closed",
      "registered",
    ],
  );
});

test("an external bracket shows as a link out named for its site", async () => {
  const markup = await renderEvent(
    {
      ...tournamentEvent,
      tournament: {
        ...openSolo,
        bracket_url: "https://www.start.gg/tournament/spring-cup",
      },
    },
    false,
  );
  assert.match(
    markup,
    /<a class="link with-arrow" href="https:\/\/www\.start\.gg\/tournament\/spring-cup" rel="noopener noreferrer" target="_blank">Bracket on start\.gg<svg[^]*?\(external site, opens in a new tab\)/,
  );
  assert.doesNotMatch(markup, /<iframe/);
  assert.deepEqual(
    [
      "https://challonge.com/spring",
      "https://spring.challonge.com/cup",
      "https://battlefy.com/cgn/spring",
      "https://www.brackets.example/spring",
    ].map(bracketHost),
    ["Challonge", "Challonge", "Battlefy", "brackets.example"],
  );
});

test("a signed-out visitor sees the registration panel, not RSVPs, and solo entrants by seed", async () => {
  const markup = await renderEvent(tournamentEvent, false);

  assert.match(markup, /Log in to register/);
  assert.match(markup, /Solo · 2 of 8 registered/);
  assert.match(markup, /Registration closes when the event starts\./);
  assert.doesNotMatch(markup, /Are you going\?/);
  assert.match(markup, /Players \(2\)/);
  assert.match(markup, /<li><span>Seed 1<\/span><\/li>/);
  assert.doesNotMatch(markup, /Bracket on/);
  assert.match(markup, /href="\/users\/public-ada"[^>]*>Ada</);
  assert.deepEqual(
    {
      attendees: vi.mocked(getEventAttendees).mock.calls.length,
      teams: vi.mocked(getRegistrationTeams).mock.calls.length,
    },
    { attendees: 0, teams: 0 },
  );
});

test("a signed-in player registers with a native form, and a team registers with a roster", async () => {
  const solo = await renderEvent(tournamentEvent, true);
  assert.match(
    solo,
    /<form class="form-stack" action="\/test\/register" method="post"><input type="hidden" name="slug" value="campus-night"\/>/,
  );
  assert.match(solo, /even if you hide yourself from people lists/);

  const team = await renderEvent(
    {
      ...tournamentEvent,
      tournament: {
        ...openSolo,
        entry_type: "team",
        team_size: 2,
        substitutes: 1,
      },
    },
    true,
  );
  assert.match(team, /Teams of 2, up to 1 substitute · 2 of 8 registered/);
  assert.match(
    team,
    /<input type="hidden" name="team_slug" value="knights"\/>/,
  );
  assert.match(team, /Pick 2 to 3 players\./);
  assert.match(
    team,
    /<input type="checkbox" name="roster" value="public-bo"\/>Bo/,
  );
  assert.deepEqual(vi.mocked(getRegistrationTeams).mock.calls, [
    [{ data: { slug: "campus-night" } }],
  ]);
});

test("a registered entrant can withdraw, an organizer can remove entries, and a notice shows", async () => {
  const registered = await renderEvent(
    {
      ...tournamentEvent,
      viewer_can_edit: true,
      tournament: {
        ...openSolo,
        viewer_entry: { id: entryID, can_manage: true },
      },
    },
    true,
    "/events/campus-night?tournament=full",
  );

  assert.match(registered, /You&#x27;re registered\./);
  assert.match(
    registered,
    new RegExp(
      `<form action="/test/withdraw" method="post"><input type="hidden" name="slug" value="campus-night"/><input type="hidden" name="entry_id" value="${entryID}"/>`,
    ),
  );
  assert.match(registered, /action="\/test\/remove"[^]*Remove Ada/);
  assert.match(registered, /This tournament is full\./);
  assert.match(
    registered,
    /href="\/events\/campus-night\/tournament"[^>]*>Tournament settings</,
  );
});

function client(fetcher: Fetcher) {
  return createApiClient({ baseUrl: "http://api:8080", fetcher });
}

test("registration operations send the roster, map refusals to notices, and read entries with the unlock", async () => {
  const requests: Array<{ url: string; method: string; body: unknown }> = [];
  const recording = client(async (input, init) => {
    requests.push({
      url: requestURL(input),
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    if (init?.method === "DELETE") return new Response(null, { status: 204 });
    return Response.json(
      { id: entryID, seed: 1, registered_at: "2037-02-01T17:00:00Z" },
      { status: 201 },
    );
  });
  const refusing = client(async () =>
    Response.json({ error: "tournament_full" }, { status: 409 }),
  );
  const failing = client(async () =>
    Response.json({ error: "tournament_registration_failed" }, { status: 500 }),
  );
  const reported: unknown[] = [];
  const dependencies = {
    cookieHeader: "cgn_session=value",
    reportError: (error: unknown) => reported.push(error),
  };
  const unlocks: Array<string | null> = [];

  const outcomes = [
    await registerOperation(
      { slug: "spring-cup", team_slug: "knights", roster: ["p1", "p2"] },
      { ...dependencies, api: recording },
    ),
    await registerOperation(
      { slug: "spring-cup", roster: [] },
      { ...dependencies, api: recording },
    ),
    await deleteEntryOperation(
      { slug: "spring-cup", entry_id: entryID },
      "withdrawn",
      { ...dependencies, api: recording },
    ),
    await registerOperation(
      { slug: "spring-cup", roster: [] },
      { ...dependencies, api: refusing },
    ),
    await registerOperation(
      { slug: "spring-cup", roster: [] },
      { ...dependencies, api: failing },
    ),
  ];
  const entries = await tournamentEntriesOperation(
    { slug: "spring-cup" },
    {
      ...dependencies,
      api: client(async (_input, init) => {
        unlocks.push(new Headers(init?.headers).get("x-cgn-event-unlock"));
        return Response.json({
          entries: [{ ...soloEntries[1], internal: "strip" }],
        });
      }),
      unlockHeaders: { "X-CGN-Event-Unlock": "unlock-token" },
    },
  );

  assert.deepEqual(
    { requests, outcomes, entries, unlocks, reported: reported.length },
    {
      requests: [
        {
          url: "http://api:8080/events/spring-cup/tournament/entries",
          method: "POST",
          body: { team_slug: "knights", roster: ["p1", "p2"] },
        },
        {
          url: "http://api:8080/events/spring-cup/tournament/entries",
          method: "POST",
          body: {},
        },
        {
          url: `http://api:8080/events/spring-cup/tournament/entries/${entryID}`,
          method: "DELETE",
          body: undefined,
        },
      ],
      outcomes: ["registered", "registered", "withdrawn", "full", "failed"].map(
        (notice) => ({
          status: "success",
          redirectTo: `/events/spring-cup?tournament=${notice}#registration`,
        }),
      ),
      entries: { status: "ready", items: [soloEntries[1]] },
      unlocks: ["unlock-token"],
      reported: 2,
    },
  );
});
