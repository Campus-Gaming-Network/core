import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vite-plus/test";
import { getEventViewerSession } from "../src/features/event-slice/auth.functions.js";
import type { EventDTO } from "../src/features/event-slice/contracts.js";
import { getEventDetail } from "../src/features/event-slice/event.functions.js";
import { getEventActivity } from "../src/features/event-activity/activity.functions.js";
import { getTournamentMatches } from "../src/features/tournament-bracket/bracket.functions.js";
import {
  generateBracketOperation,
  recordResultOperation,
  scheduleMatchOperation,
  tournamentMatchesOperation,
} from "../src/features/tournament-bracket/bracket-operations.server.js";
import {
  validateResultInput,
  validateScheduleInput,
  type TournamentMatchDTO,
} from "../src/features/tournament-bracket/contracts.js";
import {
  bracketRounds,
  matchSummary,
  scheduleDays,
  tournamentSections,
} from "../src/features/tournament-bracket/presentation.js";
import type { TournamentDTO } from "../src/features/tournament-registration/contracts.js";
import { getTournamentEntries } from "../src/features/tournament-registration/tournament.functions.js";
import { deleteEntryOperation } from "../src/features/tournament-registration/tournament-operations.server.js";
import { Route as EventRoute } from "../src/routes/events.$slug.js";
import { Route as EntrantsRoute } from "../src/routes/events.$slug_.entrants.js";
import { Route as BracketRoute } from "../src/routes/events.$slug_.bracket.js";
import { Route as ScheduleRoute } from "../src/routes/events.$slug_.schedule.js";
import { Route as MatchRoute } from "../src/routes/events.$slug_.matches.$matchId.js";
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
    approveTournamentEntry: { url: "/test/approve" },
    declineTournamentEntry: { url: "/test/decline" },
    withdrawTournamentEntry: { url: "/test/withdraw" },
    removeTournamentEntry: { url: "/test/remove" },
  }),
);
vi.mock("../src/features/tournament-bracket/bracket.functions.js", () => ({
  getTournamentMatches: vi.fn(),
  generateBracket: { url: "/test/generate" },
  recordMatchResult: { url: "/test/result" },
  scheduleMatch: { url: "/test/schedule" },
}));

beforeEach(() => vi.clearAllMocks());

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const entrant = (seed: number, name: string) => ({
  entry_id: id(100 + seed),
  seed,
  player: { public_id: `public-${name.toLowerCase()}`, name },
});
const [eli, dee, cal, ben, ana] = [
  entrant(1, "Eli"),
  entrant(2, "Dee"),
  entrant(3, "Cal"),
  entrant(4, "Ben"),
  entrant(5, "Ana"),
];

// Five players fill an eight-slot bracket: seeds 1 to 3 have byes. Ben beat
// Ana 2–1 and meets Eli; Cal did not show, so Dee is in the final.
const matches: TournamentMatchDTO[] = [
  {
    id: id(12),
    round: 1,
    position: 2,
    entrants: [ben, ana],
    status: "complete",
    scores: [2, 1],
    winner_entry_id: ben.entry_id,
    next_match_id: id(21),
  },
  {
    id: id(21),
    round: 2,
    position: 1,
    entrants: [eli, ben],
    status: "upcoming",
    next_match_id: id(31),
  },
  {
    id: id(22),
    round: 2,
    position: 2,
    entrants: [dee, cal],
    status: "complete",
    winner_entry_id: dee.entry_id,
    walkover: true,
    next_match_id: id(31),
  },
  {
    id: id(31),
    round: 3,
    position: 1,
    entrants: [null, dee],
    status: "upcoming",
  },
];

const running: TournamentDTO = {
  game: { id: "game-1", name: "Chess", slug: "chess" },
  entry_type: "solo",
  substitutes: 0,
  format: "single_elimination",
  rules: "Best of three.",
  prizes: "",
  registration_mode: "open",
  status: "in_progress",
  entry_count: 5,
};
const tournamentEvent: EventDTO = {
  ...routeEvent,
  visibility: "public",
  event_type: "tournament",
  tournament: running,
};

function client(fetcher: Fetcher) {
  return createApiClient({ baseUrl: "http://api:8080", fetcher });
}

function stubPage(event: EventDTO, bracket: TournamentMatchDTO[]) {
  vi.mocked(getEventViewerSession).mockResolvedValue({
    status: "authenticated",
    authenticated: true,
    hasSessionCookie: true,
  });
  vi.mocked(getEventDetail).mockResolvedValue({ status: "found", event });
  vi.mocked(getEventActivity).mockResolvedValue({ status: "unavailable" });
  vi.mocked(getTournamentEntries).mockResolvedValue({
    status: "ready",
    items: [],
    requests: [],
  });
  vi.mocked(getTournamentMatches).mockResolvedValue({
    status: "ready",
    matches: bracket,
  });
}

test("tabs show only the sections with content: the bracket once generated, rules and prizes when written", () => {
  assert.deepEqual(
    [
      tournamentSections({ ...running, rules: "" }, false),
      tournamentSections(
        { ...running, entry_type: "team", entry_count: 4, prizes: "$50" },
        true,
      ),
    ],
    [
      [
        { section: "overview", label: "Overview" },
        { section: "entrants", label: "Players (5)" },
      ],
      [
        { section: "overview", label: "Overview" },
        { section: "entrants", label: "Teams (4)" },
        { section: "bracket", label: "Bracket" },
        { section: "rules", label: "Rules" },
        { section: "prizes", label: "Prizes" },
      ],
    ],
  );
});

test("the round list lines each match up between its feeders, with byes where a first-round match is missing", () => {
  assert.deepEqual(
    bracketRounds(matches).map((round) => ({
      name: round.name,
      items: round.items.map((item) =>
        item.kind === "bye"
          ? `bye ${item.bye.entrant.player?.name} row ${item.row}`
          : `${matchSummary(item.match, 3)} row ${item.row} span ${item.span}`,
      ),
    })),
    [
      {
        name: "Quarterfinals",
        items: [
          "bye Eli row 1",
          "Quarterfinals, match 2: Ben (seed 4) 2 vs Ana (seed 5) 1. Ben won. row 2 span 1",
          "bye Dee row 3",
          "bye Cal row 4",
        ],
      },
      {
        name: "Semifinals",
        items: [
          "Semifinals, match 1: Eli (seed 1) vs Ben (seed 4). Upcoming. row 1 span 2",
          "Semifinals, match 2: Dee (seed 2) vs Cal (seed 3). Dee advanced on a walkover. row 3 span 2",
        ],
      },
      {
        name: "Final",
        items: ["Final: to be decided vs Dee (seed 2). Upcoming. row 1 span 4"],
      },
    ],
  );
});

test("the bracket page renders every match once, as a link named with its entrants and score, in one list that stacks on a phone", async () => {
  stubPage(tournamentEvent, matches);
  const markup = (
    await loadRoute(
      BracketRoute,
      "/events/$slug/bracket",
      "/events/campus-night/bracket",
    )
  ).render();

  const labels = [
    ...markup.matchAll(
      /class="bracket-match" aria-label="([^"]*)"|aria-label="([^"]*)" class="bracket-match"/g,
    ),
  ].map((found) => (found[1] ?? found[2]).replaceAll("&#x27;", "'"));
  assert.deepEqual(
    labels,
    matches.map((match) => matchSummary(match, 3)),
  );
  assert.equal(markup.match(/<ol class="bracket__rounds"/g)?.length, 1);
  assert.match(
    markup,
    /<nav aria-label="Jump to round" class="bracket__jump"><a href="#round-1">Quarterfinals<\/a><a href="#round-2">Semifinals<\/a><a href="#round-3">Final<\/a><\/nav>/,
  );
  assert.match(
    markup,
    /href="\/events\/campus-night\/matches\/00000000-0000-4000-8000-000000000012"/,
  );
  assert.deepEqual(
    [...markup.matchAll(/class="tabs__link"[^>]*>([^<]*)</g)].map(
      (found) => found[1],
    ),
    ["Overview", "Players (5)", "Bracket", "Rules"],
  );
  assert.match(markup, /aria-current="page">Bracket</);
  assert.doesNotMatch(markup, />Prizes</);
});

test("the event page adds the Bracket tab only once a bracket exists", async () => {
  stubPage(tournamentEvent, []);
  const without = (
    await loadRoute(EventRoute, "/events/$slug", "/events/campus-night")
  ).render();
  stubPage(tournamentEvent, matches);
  const withBracket = (
    await loadRoute(EventRoute, "/events/$slug", "/events/campus-night")
  ).render();
  stubPage(
    {
      ...tournamentEvent,
      tournament: { ...running, status: "registration_open" },
    },
    [],
  );
  vi.mocked(getTournamentMatches).mockClear();
  await loadRoute(EventRoute, "/events/$slug", "/events/campus-night");

  assert.deepEqual(
    [without, withBracket].map((markup) =>
      [...markup.matchAll(/class="tabs__link"[^>]*>([^<]*)</g)].map(
        (found) => found[1],
      ),
    ),
    [
      ["Overview", "Players (5)", "Rules"],
      ["Overview", "Players (5)", "Bracket", "Rules"],
    ],
  );
  // Before the start there is no bracket to read.
  assert.equal(vi.mocked(getTournamentMatches).mock.calls.length, 0);
});

test("an organizer gets native result and walkover forms for a decided match; others and fixed results get none", async () => {
  const organizerEvent = { ...tournamentEvent, viewer_can_edit: true };
  stubPage(organizerEvent, matches);
  const semifinal = (
    await loadRoute(
      MatchRoute,
      "/events/$slug/matches/$matchId",
      `/events/campus-night/matches/${id(21)}?bracket=saved`,
    )
  ).render();
  stubPage(tournamentEvent, matches);
  const spectator = (
    await loadRoute(
      MatchRoute,
      "/events/$slug/matches/$matchId",
      `/events/campus-night/matches/${id(21)}`,
    )
  ).render();
  stubPage(organizerEvent, matches);
  const final = (
    await loadRoute(
      MatchRoute,
      "/events/$slug/matches/$matchId",
      `/events/campus-night/matches/${id(31)}`,
    )
  ).render();
  stubPage(organizerEvent, [
    { ...matches[0] },
    {
      ...matches[1],
      status: "complete",
      scores: [3, 0],
      winner_entry_id: eli.entry_id,
    },
    ...matches.slice(2),
  ]);
  const fixed = (
    await loadRoute(
      MatchRoute,
      "/events/$slug/matches/$matchId",
      `/events/campus-night/matches/${id(12)}`,
    )
  ).render();

  assert.equal(
    semifinal.match(
      /<form class="match-result-form" action="\/test\/result" method="post">/g,
    )?.length,
    2,
  );
  assert.match(semifinal, /Result saved\. The winner has moved on\./);
  assert.match(semifinal, /required=""[^>]*name="score1"/);
  assert.match(
    semifinal,
    /<input type="hidden" name="walkover" value="true"\/>/,
  );
  assert.match(semifinal, /The winner plays in <a[^>]*>Final<\/a>/);
  assert.doesNotMatch(spectator, /match-result-form/);
  assert.match(
    final,
    /The result can be entered once both sides are decided\./,
  );
  assert.match(fixed, /can no longer change/);
  assert.doesNotMatch(fixed, /match-result-form/);
});

test("a result form needs both scores, or a walkover with none", () => {
  const form = (fields: Record<string, string>) => {
    const data = new FormData();
    for (const [name, value] of Object.entries({
      slug: "spring-cup",
      match_id: id(21),
      winner_entry_id: eli.entry_id,
      ...fields,
    })) {
      data.set(name, value);
    }
    return validateResultInput(data);
  };
  assert.deepEqual(
    [
      form({ walkover: "false", score1: "3", score2: "0" }),
      form({ walkover: "false", score1: "", score2: "0" }),
      form({ walkover: "true", score1: "3" }),
    ],
    [
      {
        valid: true,
        value: {
          slug: "spring-cup",
          match_id: id(21),
          winner_entry_id: eli.entry_id,
          walkover: false,
          scores: [3, 0],
        },
      },
      { valid: false, slug: "spring-cup", matchID: id(21) },
      {
        valid: true,
        value: {
          slug: "spring-cup",
          match_id: id(21),
          winner_entry_id: eli.entry_id,
          walkover: true,
        },
      },
    ],
  );
});

test("bracket operations read the matches, generate the bracket, and post results, mapping each refusal to a notice", async () => {
  const requests: Array<{ url: string; method: string; body: unknown }> = [];
  const recording = client(async (input, init) => {
    requests.push({
      url: requestURL(input),
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return Response.json({ matches });
  });
  const refusing = (code: string) =>
    client(async () => Response.json({ error: code }, { status: 409 }));
  const reported: unknown[] = [];
  const dependencies = {
    cookieHeader: "cgn_session=value",
    reportError: (error: unknown) => reported.push(error),
  };
  const base = {
    slug: "spring-cup",
    match_id: id(21),
    winner_entry_id: eli.entry_id,
  };

  const outcomes = [
    await tournamentMatchesOperation(
      { slug: "spring-cup" },
      { ...dependencies, api: recording },
    ),
    await generateBracketOperation(
      { slug: "spring-cup" },
      { ...dependencies, api: recording },
    ),
    await recordResultOperation(
      { ...base, walkover: false, scores: [3, 0] },
      { ...dependencies, api: recording },
    ),
    await recordResultOperation(
      { ...base, walkover: true },
      { ...dependencies, api: recording },
    ),
    await generateBracketOperation(
      { slug: "spring-cup" },
      { ...dependencies, api: refusing("tournament_bracket_locked") },
    ),
    await recordResultOperation(
      { ...base, walkover: true },
      { ...dependencies, api: refusing("tournament_result_locked") },
    ),
    await recordResultOperation(
      { ...base, walkover: true },
      { ...dependencies, api: refusing("something_new") },
    ),
  ];

  const resultURL = `http://api:8080/events/spring-cup/tournament/matches/${id(21)}/result`;
  const matchPage = `/events/spring-cup/matches/${id(21)}`;
  assert.deepEqual(
    { outcomes, requests, reported: reported.length },
    {
      outcomes: [
        { status: "ready", matches },
        {
          status: "success",
          redirectTo: "/events/spring-cup/bracket?bracket=generated",
        },
        { status: "success", redirectTo: `${matchPage}?bracket=saved` },
        { status: "success", redirectTo: `${matchPage}?bracket=saved` },
        {
          status: "success",
          redirectTo: "/events/spring-cup/tournament?bracket=bracket-locked",
        },
        { status: "success", redirectTo: `${matchPage}?bracket=result-locked` },
        { status: "success", redirectTo: `${matchPage}?bracket=failed` },
      ],
      requests: [
        {
          url: "http://api:8080/events/spring-cup/tournament/matches",
          method: "GET",
          body: undefined,
        },
        {
          url: "http://api:8080/events/spring-cup/tournament/bracket",
          method: "POST",
          body: undefined,
        },
        {
          url: resultURL,
          method: "POST",
          body: { winner_entry_id: eli.entry_id, scores: [3, 0] },
        },
        {
          url: resultURL,
          method: "POST",
          body: { winner_entry_id: eli.entry_id, walkover: true },
        },
      ],
      reported: 3,
    },
  );
});

test("Overview previews the first eight entrants and links to the tab, which lists everyone and lets organizers remove one", async () => {
  const players = Array.from({ length: 10 }, (_, index) => ({
    id: id(200 + index),
    status: "registered" as const,
    seed: index + 1,
    player: { public_id: `public-p${index + 1}`, name: `Player ${index + 1}` },
    registered_at: "2037-02-01T17:00:00Z",
  }));
  const registering = {
    ...tournamentEvent,
    viewer_can_edit: true,
    tournament: {
      ...running,
      status: "registration_open" as const,
      entry_count: 10,
    },
  };
  stubPage(registering, []);
  vi.mocked(getTournamentEntries).mockResolvedValue({
    status: "ready",
    items: players,
    requests: [],
  });
  const overview = (
    await loadRoute(EventRoute, "/events/$slug", "/events/campus-night")
  ).render();
  const tab = (
    await loadRoute(
      EntrantsRoute,
      "/events/$slug/entrants",
      "/events/campus-night/entrants?tournament=removed",
    )
  ).render();
  assert.deepEqual(
    [overview, tab].map((markup) =>
      [
        ...markup.matchAll(/href="\/users\/public-p\d+"[^>]*>(Player \d+)</g),
      ].map((found) => found[1]),
    ),
    [
      players.slice(0, 8).map((player) => player.player.name),
      players.map((player) => player.player.name),
    ],
  );
  assert.match(
    overview,
    /href="\/events\/campus-night\/entrants"[^>]*>See all players/,
  );
  assert.doesNotMatch(overview, /Remove Player/);
  assert.equal(
    tab.match(/<input type="hidden" name="return_to" value="entrants"\/>/g)
      ?.length,
    10,
  );
  assert.match(tab, /Entry removed\./);
});

test("a removal made on the Players tab returns there with its notice", async () => {
  const api = client(async () => new Response(null, { status: 204 }));
  const refusing = client(async () =>
    Response.json({ error: "tournament_started" }, { status: 409 }),
  );
  const dependencies = {
    cookieHeader: "cgn_session=value",
    reportError: () => {},
  };
  const entry = { slug: "spring-cup", entry_id: id(201) };
  assert.deepEqual(
    [
      await deleteEntryOperation(
        { ...entry, return_to: "entrants" },
        "removed",
        { ...dependencies, api },
      ),
      await deleteEntryOperation(
        { ...entry, return_to: "entrants" },
        "removed",
        { ...dependencies, api: refusing },
      ),
      await deleteEntryOperation(entry, "withdrawn", { ...dependencies, api }),
    ].map((result) => result.redirectTo),
    [
      "/events/spring-cup/entrants?tournament=removed",
      "/events/spring-cup/entrants?tournament=started",
      "/events/spring-cup?tournament=withdrawn#registration",
    ],
  );
});

// The semifinals on Saturday evening and the final just after midnight, in
// the event's zone (Los Angeles, daylight time).
const scheduled: TournamentMatchDTO[] = [
  matches[0],
  { ...matches[1], scheduled_at: "2037-06-07T02:30:00Z" },
  { ...matches[2], scheduled_at: "2037-06-07T01:00:00Z" },
  { ...matches[3], scheduled_at: "2037-06-07T07:15:00Z" },
];

test("the Schedule tab shows once a match has a time, and lists matches by day and time in the event's zone", async () => {
  const timeZone = routeEvent.timezone;
  assert.deepEqual(
    {
      tabs: tournamentSections(running, true, true).map((tab) => tab.label),
      days: scheduleDays(scheduled, timeZone).map(
        ({ day, matches: listed }) => ({
          day,
          ids: listed.map((match) => match.id),
        }),
      ),
    },
    {
      tabs: ["Overview", "Players (5)", "Bracket", "Schedule", "Rules"],
      days: [
        { day: "Sat, Jun 6, 2037", ids: [id(22), id(21)] },
        { day: "Sun, Jun 7, 2037", ids: [id(31)] },
      ],
    },
  );

  stubPage(tournamentEvent, scheduled);
  const page = (
    await loadRoute(
      ScheduleRoute,
      "/events/$slug/schedule",
      "/events/campus-night/schedule",
    )
  ).render();
  assert.deepEqual(
    [
      ...page.matchAll(
        /<time dateTime="[^"]+">([^<]+)<\/time><a[^>]*>([^<]+)<\/a>/g,
      ),
    ].map((found) => `${found[1]} ${found[2]}`),
    [
      "6:00 PM PDT Semifinals, match 2",
      "7:30 PM PDT Semifinals, match 1",
      "12:15 AM PDT Final",
    ],
  );
  assert.match(page, /aria-current="page">Schedule</);
});

test("an organizer sets a match time in the event's zone until the match has a result", async () => {
  stubPage({ ...tournamentEvent, viewer_can_edit: true }, scheduled);
  const upcoming = (
    await loadRoute(
      MatchRoute,
      "/events/$slug/matches/$matchId",
      `/events/campus-night/matches/${id(21)}`,
    )
  ).render();
  const decided = (
    await loadRoute(
      MatchRoute,
      "/events/$slug/matches/$matchId",
      `/events/campus-night/matches/${id(22)}`,
    )
  ).render();
  const data = (fields: Record<string, string>) => {
    const values = new FormData();
    for (const [name, value] of Object.entries({
      slug: "spring-cup",
      match_id: id(21),
      timezone: "America/Los_Angeles",
      ...fields,
    })) {
      values.set(name, value);
    }
    return values;
  };

  assert.match(
    upcoming,
    /type="datetime-local"[^>]*name="scheduled_at" value="2037-06-06T19:30"/,
  );
  assert.match(upcoming, />Clear time</);
  assert.doesNotMatch(decided, /Match time</);
  assert.deepEqual(
    [
      validateScheduleInput(data({ scheduled_at: "2037-06-06T19:30" })),
      validateScheduleInput(data({ scheduled_at: "" })),
      // Clocks skip 2:00 to 3:00 that morning in Los Angeles.
      validateScheduleInput(data({ scheduled_at: "2037-03-08T02:30" })),
    ],
    [
      {
        valid: true,
        value: {
          slug: "spring-cup",
          match_id: id(21),
          scheduled_at: "2037-06-07T02:30:00.000Z",
        },
      },
      {
        valid: true,
        value: { slug: "spring-cup", match_id: id(21), scheduled_at: null },
      },
      { valid: false, slug: "spring-cup", matchID: id(21) },
    ],
  );
});

test("scheduling sends the time or null and maps a time outside the event to a notice", async () => {
  const bodies: unknown[] = [];
  const api = client(async (_input, init) => {
    bodies.push(init?.body ? JSON.parse(String(init.body)) : undefined);
    return Response.json({ matches: scheduled });
  });
  const outside = client(async () =>
    Response.json({ error: "match_time_outside_event" }, { status: 422 }),
  );
  const dependencies = {
    cookieHeader: "cgn_session=value",
    reportError: () => {},
  };
  const input = { slug: "spring-cup", match_id: id(21) };
  const matchPage = `/events/spring-cup/matches/${id(21)}?bracket=`;
  assert.deepEqual(
    {
      outcomes: [
        await scheduleMatchOperation(
          { ...input, scheduled_at: "2037-06-07T02:30:00.000Z" },
          { ...dependencies, api },
        ),
        await scheduleMatchOperation(
          { ...input, scheduled_at: null },
          { ...dependencies, api },
        ),
        await scheduleMatchOperation(
          { ...input, scheduled_at: "2037-06-07T02:30:00.000Z" },
          { ...dependencies, api: outside },
        ),
      ].map((result) => result.redirectTo),
      bodies,
    },
    {
      outcomes: [
        `${matchPage}scheduled`,
        `${matchPage}unscheduled`,
        `${matchPage}time-invalid`,
      ],
      bodies: [
        { scheduled_at: "2037-06-07T02:30:00.000Z" },
        { scheduled_at: null },
      ],
    },
  );
});
