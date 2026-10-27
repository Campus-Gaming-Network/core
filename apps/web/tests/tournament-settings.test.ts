import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vite-plus/test";
import { getEventViewerSession } from "../src/features/event-slice/auth.functions.js";
import type { EventDTO } from "../src/features/event-slice/contracts.js";
import { getEventDetail } from "../src/features/event-slice/event.functions.js";
import type { TournamentDTO } from "../src/features/tournament-registration/contracts.js";
import { validateSettingsInput } from "../src/features/tournament-settings/contracts.js";
import { statusActions } from "../src/features/tournament-settings/presentation.js";
import {
  deleteSettingsOperation,
  saveSettingsOperation,
  setStatusOperation,
} from "../src/features/tournament-settings/settings-operations.server.js";
import { Route } from "../src/routes/events.$slug_.tournament.js";
import { createApiClient, type Fetcher } from "../src/server/api.server.js";
import { requestURL } from "./fetch-stub.js";
import { routeEvent } from "./route-fixtures.js";
import { loadRoute } from "./route-test.js";

vi.mock("../src/features/event-slice/auth.functions.js", () => ({
  getEventViewerSession: vi.fn(),
}));
vi.mock("../src/features/event-slice/event.functions.js", () => ({
  getEventDetail: vi.fn(),
}));
vi.mock("../src/features/tournament-settings/settings.functions.js", () => ({
  saveTournamentSettings: { url: "/test/save" },
  deleteTournamentSettings: { url: "/test/delete" },
  setTournamentStatus: { url: "/test/status" },
}));

beforeEach(() => vi.clearAllMocks());

const chess = { id: "game-1", name: "Chess", slug: "chess" };
const draft: TournamentDTO = {
  game: chess,
  entry_type: "team",
  team_size: 5,
  substitutes: 1,
  format: "single_elimination",
  rules: "",
  prizes: "",
  status: "draft",
  entry_count: 0,
};
const tournamentEvent: EventDTO = {
  ...routeEvent,
  visibility: "public",
  event_type: "tournament",
  games: [{ ...chess, has_cover: false }],
  viewer_can_edit: true,
};

async function renderPage(
  event: EventDTO,
  href = "/events/campus-night/tournament",
) {
  vi.mocked(getEventViewerSession).mockResolvedValue({
    status: "authenticated",
    authenticated: true,
    hasSessionCookie: true,
  });
  vi.mocked(getEventDetail).mockResolvedValue({ status: "found", event });
  return (await loadRoute(Route, "/events/$slug/tournament", href)).render();
}

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [name, value] of Object.entries({
    slug: "spring-cup",
    game_id: "game-1",
    entry_type: "team",
    team_size: "5",
    substitutes: "1",
    entrant_cap: "16",
    registration_closes_at: "2037-02-19T17:00",
    timezone: "America/Los_Angeles",
    rules: "  Best of three.  ",
    prizes: "",
    ...fields,
  })) {
    data.set(name, value);
  }
  return validateSettingsInput(data);
}

test("the settings form becomes the API's request: whole numbers, team fields for teams only, and the close time in the event's zone", () => {
  assert.deepEqual(
    [
      form({}),
      form({ entry_type: "solo", entrant_cap: "", registration_closes_at: "" }),
      form({ team_size: "1" }),
      form({ substitutes: "6" }),
      form({ entrant_cap: "513" }),
      form({ entry_type: "duo" }),
    ],
    [
      {
        valid: true,
        value: {
          slug: "spring-cup",
          settings: {
            game_id: "game-1",
            entry_type: "team",
            team_size: 5,
            substitutes: 1,
            entrant_cap: 16,
            registration_closes_at: "2037-02-20T01:00:00.000Z",
            format: "single_elimination",
            rules: "Best of three.",
            prizes: "",
          },
        },
      },
      {
        valid: true,
        value: {
          slug: "spring-cup",
          settings: {
            game_id: "game-1",
            entry_type: "solo",
            substitutes: 0,
            format: "single_elimination",
            rules: "Best of three.",
            prizes: "",
          },
        },
      },
      { valid: false, slug: "spring-cup" },
      { valid: false, slug: "spring-cup" },
      { valid: false, slug: "spring-cup" },
      { valid: false, slug: "spring-cup" },
    ],
  );
});

function labels(tournament: TournamentDTO, ended = false) {
  return statusActions(tournament, { ended }).map((action) =>
    action.kind === "delete" ? "Delete settings" : action.label,
  );
}

test("the status panel offers only the moves the API allows", () => {
  const open = { ...draft, status: "registration_open" as const };

  assert.deepEqual(
    [
      labels(draft),
      labels(open),
      labels({ ...open, entry_count: 1 }),
      labels({ ...open, entry_count: 2 }),
      labels({ ...draft, status: "in_progress" }),
      labels({ ...draft, status: "in_progress" }, true),
      labels(open, true),
      labels({ ...draft, status: "completed" }),
    ],
    [
      ["Open registration", "Delete settings", "Cancel tournament"],
      ["Back to draft", "Cancel tournament"],
      ["Cancel tournament"],
      ["Start tournament", "Cancel tournament"],
      ["Mark complete", "Cancel tournament"],
      ["Mark complete"],
      [],
      [],
    ],
  );
});

function client(fetcher: Fetcher) {
  return createApiClient({ baseUrl: "http://api:8080", fetcher });
}

test("settings operations send the settings and status, and map each refusal to a notice", async () => {
  const requests: Array<{ url: string; method: string; body: unknown }> = [];
  const recording = client(async (input, init) => {
    requests.push({
      url: requestURL(input),
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    if (init?.method === "DELETE") return new Response(null, { status: 204 });
    return Response.json(draft);
  });
  const refusing = (code: string) =>
    client(async () => Response.json({ error: code }, { status: 409 }));
  const reported: unknown[] = [];
  const dependencies = {
    cookieHeader: "cgn_session=value",
    reportError: (error: unknown) => reported.push(error),
  };
  const settings = {
    game_id: "game-1",
    entry_type: "solo" as const,
    substitutes: 0,
    format: "single_elimination" as const,
    rules: "",
    prizes: "",
  };

  const outcomes = [
    await saveSettingsOperation(
      { slug: "spring-cup", settings },
      { ...dependencies, api: recording },
    ),
    await setStatusOperation(
      { slug: "spring-cup", status: "registration_open" },
      { ...dependencies, api: recording },
    ),
    await deleteSettingsOperation(
      { slug: "spring-cup" },
      { ...dependencies, api: recording },
    ),
    ...(await Promise.all(
      [
        "event_has_rsvps",
        "tournament_game_not_on_event",
        "tournament_needs_entrants",
        "tournament_has_entries",
        "tournament_update_failed",
      ].map((code) =>
        saveSettingsOperation(
          { slug: "spring-cup", settings },
          { ...dependencies, api: refusing(code) },
        ),
      ),
    )),
  ];

  assert.deepEqual(
    { requests, outcomes, reported: reported.length },
    {
      requests: [
        {
          url: "http://api:8080/events/spring-cup/tournament",
          method: "PUT",
          body: settings,
        },
        {
          url: "http://api:8080/events/spring-cup/tournament/status",
          method: "POST",
          body: { status: "registration_open" },
        },
        {
          url: "http://api:8080/events/spring-cup/tournament",
          method: "DELETE",
          body: undefined,
        },
      ],
      outcomes: [
        "saved",
        "registration_open",
        "deleted",
        "has-rsvps",
        "game",
        "needs-entrants",
        "has-entries",
        "failed",
      ].map((notice) => ({
        status: "success",
        redirectTo: `/events/spring-cup/tournament?settings=${notice}`,
      })),
      reported: 5,
    },
  );
});

test("the settings page sends a signed-out viewer through login", async () => {
  vi.mocked(getEventViewerSession).mockResolvedValue({
    status: "unauthenticated",
    authenticated: false,
    hasSessionCookie: false,
  });
  const { response } = await loadRoute(
    Route,
    "/events/$slug/tournament",
    "/events/campus-night/tournament",
  );
  assert.deepEqual(
    response?.type === "redirect"
      ? {
          href: response.redirect.options.href,
          statusCode: response.redirect.status,
        }
      : undefined,
    { href: "/login?next=/events/campus-night/tournament", statusCode: 307 },
  );
});

test("an organizer creates settings with a native form; a non-organizer and a non-tournament event get no form", async () => {
  const create = await renderPage(tournamentEvent);
  assert.match(
    create,
    /<form class="form-stack sectioned-form" action="\/test\/save" method="post"><input type="hidden" name="slug" value="campus-night"\/><input type="hidden" name="timezone" value="America\/Los_Angeles"\/>/,
  );
  assert.match(create, /<option value="game-1" selected="">Chess<\/option>/);
  assert.match(
    create,
    /max="2037-02-19T18:00" type="datetime-local" aria-labelledby="[^"]+" name="registration_closes_at"/,
  );
  assert.match(create, />Create tournament</);
  assert.doesNotMatch(create, /Status:/);

  const outsider = await renderPage({
    ...tournamentEvent,
    viewer_can_edit: false,
  });
  assert.match(
    outsider,
    /Only the event&#x27;s organizers can set up its tournament\./,
  );
  assert.doesNotMatch(outsider, /action="\/test\/save"/);

  const meeting = await renderPage({
    ...tournamentEvent,
    event_type: "meeting",
  });
  assert.match(meeting, /This event isn&#x27;t a tournament\./);
  assert.match(meeting, /href="\/events\/campus-night\/edit"/);
  assert.doesNotMatch(meeting, /action="\/test\/save"/);
});

test("with settings, the page shows the status moves, fixes the entry type once anyone registers, and shows a refusal", async () => {
  const markup = await renderPage(
    {
      ...tournamentEvent,
      tournament: { ...draft, status: "registration_open", entry_count: 1 },
    },
    "/events/campus-night/tournament?settings=needs-entrants",
  );

  assert.match(markup, /Status: Registration open/);
  assert.match(
    markup,
    /<form action="\/test\/status" method="post"><input type="hidden" name="slug" value="campus-night"\/><input type="hidden" name="status" value="cancelled"\/>/,
  );
  assert.doesNotMatch(
    markup,
    /value="in_progress"|value="draft"|\/test\/delete/,
  );
  assert.match(markup, /Starting needs at least two entrants\./);
  assert.match(
    markup,
    /<input type="hidden" name="entry_type" value="team"\/><input type="hidden" name="team_size" value="5"\/>/,
  );
  assert.doesNotMatch(markup, /type="radio"/);
  assert.match(markup, />Save settings</);

  const ended = await renderPage({
    ...tournamentEvent,
    lifecycle: "ended",
    tournament: { ...draft, status: "in_progress", entry_count: 4 },
  });
  assert.match(ended, /value="completed"/);
  assert.doesNotMatch(ended, /action="\/test\/save"|value="cancelled"/);
});
