import assert from "node:assert/strict";
import { beforeEach, test, vi } from "vite-plus/test";
import {
  getNewTeamPage,
  getTeamDetail,
  getTeamsBrowsePage,
} from "../src/features/team-slice/team.functions.js";
import { getEventViewerSession } from "../src/features/event-slice/auth.functions.js";
import { getTeamEvents } from "../src/features/event-slice/event.functions.js";
import { getTeamMembers } from "../src/features/people-slice/people.functions.js";
import { Route as NewRoute } from "../src/routes/teams.new.js";
import { Route as BrowseRoute } from "../src/routes/teams.index.js";
import { Route as DetailRoute } from "../src/routes/teams.$slug.js";
import { loadRoute } from "./route-test.js";

vi.mock("../src/features/team-slice/team.functions.js", () => ({
  getNewTeamPage: vi.fn(),
  getTeamDetail: vi.fn(),
  getTeamsBrowsePage: vi.fn(),
  createTeam: { url: "/test/create-team" },
  joinTeam: { url: "/test/join-team" },
  leaveTeam: { url: "/test/leave-team" },
  removeTeamMember: { url: "/test/remove-member" },
  setTeamCaptain: { url: "/test/set-captain" },
  transferTeamOwnership: { url: "/test/transfer-team" },
}));
vi.mock("../src/features/event-slice/auth.functions.js", () => ({
  getEventViewerSession: vi.fn(),
}));
vi.mock("../src/features/event-slice/event.functions.js", () => ({
  getTeamEvents: vi.fn(),
}));
vi.mock("../src/features/people-slice/people.functions.js", () => ({
  getTeamMembers: vi.fn(),
}));
beforeEach(() => vi.clearAllMocks());

test("team creation redirects a signed-out viewer to login with a return path", async () => {
  vi.mocked(getNewTeamPage).mockResolvedValue({ status: "unauthenticated" });
  const { response } = await loadRoute(NewRoute, "/teams/new");
  assert.equal(response?.type, "redirect");
  assert.equal(
    response?.type === "redirect" && response.redirect.headers.get("location"),
    "/login?next=%2Fteams%2Fnew",
  );
});

test("team creation renders native search, password and game fields and a POST form", async () => {
  vi.mocked(getNewTeamPage).mockResolvedValue({
    status: "ready",
    defaultSchoolID: "school-1",
    schools: [{ id: "school-1", name: "Example University", slug: "example" }],
    games: [{ id: "game-1", name: "Example Game", slug: "example-game" }],
    schoolSearchFailed: false,
  });
  const { match, render } = await loadRoute(
    NewRoute,
    "/teams/new",
    "/teams/new?school_q=Example",
  );
  assert.deepEqual(match?.headers, {
    "cache-control": "private, no-store",
    vary: "Cookie",
  });
  assert.ok(Array.isArray(match?.meta));
  assert.ok(
    match.meta.some(
      (tag) => tag?.name === "robots" && tag.content === "noindex,nofollow",
    ),
  );
  const markup = render();
  assert.match(
    markup,
    /<form[^>]*action="\/test\/create-team"[^>]*method="post"/,
  );
  assert.match(markup, /action="\/teams\/new"/);
  assert.match(markup, /name="school_id"/);
  assert.match(markup, /name="game_ids"/);
  assert.match(markup, /type="password"/);
  assert.match(markup, /href="\/teams"/);
});

for (const hasSessionCookie of [false, true]) {
  for (const [route, path, href] of [
    [BrowseRoute, "/teams/", "/teams"],
    [DetailRoute, "/teams/$slug", "/teams/campus-team"],
  ] as const) {
    test(`${path} uses cookie-aware caching (${hasSessionCookie})`, async () => {
      vi.mocked(getEventViewerSession).mockResolvedValue({
        status: "unauthenticated",
        authenticated: false,
        hasSessionCookie,
      });
      vi.mocked(getTeamsBrowsePage).mockResolvedValue({
        teams: [],
        limit: 25,
        has_more: false,
        has_previous: false,
        teamsUnavailable: false,
        schools: [],
        schoolSearchFailed: false,
        games: [],
        gameSearchFailed: false,
      });
      vi.mocked(getTeamDetail).mockResolvedValue({
        status: "found",
        hasSessionCookie,
        team: {
          id: "team-1",
          slug: "campus-team",
          name: "Campus team",
          description: "Play together.",
          games: [],
          member_count: 2,
        },
      });
      vi.mocked(getTeamMembers).mockResolvedValue({ status: "signed_out" });
      vi.mocked(getTeamEvents).mockResolvedValue({
        events: [],
        unavailable: false,
      });
      const { match, render } = await loadRoute(route, path, href);
      assert.deepEqual(match?.headers, {
        "cache-control": hasSessionCookie
          ? "private, no-store"
          : "public, max-age=0, must-revalidate",
        vary: "Cookie",
      });
      assert.match(render(), /<main/);
    });
  }
}
