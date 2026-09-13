import assert from "node:assert/strict";
import test from "node:test";
import { createApiClient, type Fetcher } from "../src/server/api.server.js";
import {
  validateCreateTeamServerInput,
  validateJoinTeamServerInput,
  validateSetTeamCaptainServerInput,
  validateTransferTeamOwnershipServerInput,
  teamDtoSchema,
  teamsBrowseInput,
  validateTeamDetailSearch,
  validateNewTeamSearch,
  validateTeamsSearch
} from "../src/features/team-slice/contracts.js";
import {
  createTeamOperation,
  joinTeamOperation,
  newTeamPageOperation,
  safeTeamMutationMessage,
  setTeamCaptainOperation,
  teamDetailOperation,
  teamsBrowseOperation,
  transferTeamOwnershipOperation
} from "../src/features/team-slice/team-operations.server.js";
import {
  newTeamHead,
  teamHead,
  teamRoleLabel,
  teamsHead
} from "../src/features/team-slice/presentation.js";

const team = {
  id: "team-1",
  name: "Varsity Rocket League",
  slug: "varsity/rocket-league",
  description: "Compete on campus.",
  owner_user_id: "owner-private-id",
  member_count: 3,
  school: {
    id: "school-1",
    name: "Example University",
    slug: "example-university",
    city: "Irvine",
    state: "CA"
  },
  games: [{ id: "game-1", name: "Rocket League", slug: "rocket-league" }],
  viewer_role: "owner",
  members: [
    {
      user_id: "member-private-id",
      name: "Private Member",
      role: "member",
      email: "private-member@example.test"
    }
  ],
  password: "must-not-serialize",
  session: "must-not-serialize",
  "X-CGN-Proxy-Secret": "must-not-serialize"
};

function client(fetcher: Fetcher) {
  return createApiClient({ baseUrl: "http://api:8080", fetcher });
}

test("team browse preserves encoded filters/cursors, uses no-store, and strips private additions", async () => {
  const calls: Array<{ init?: RequestInit; url: string }> = [];
  const result = await teamsBrowseOperation(
    {
      game: "rocket league",
      school: "example/university",
      after: "next+cursor",
      before: "previous/cursor"
    },
    {
      api: client(async (input, init) => {
        const url = String(input);
        calls.push({ init, url });
        return url.endsWith("/games")
          ? Response.json({
              games: [
                {
                  id: "game-1",
                  name: "Rocket League",
                  slug: "rocket-league",
                  cover_url: "private-addition"
                }
              ]
            })
          : Response.json({
              teams: [team],
              limit: 25,
              has_more: true,
              has_previous: true,
              next_cursor: "next",
              previous_cursor: "previous",
              internal: "must-not-serialize"
            });
      })
    }
  );

  const teamCall = calls.find(({ url }) => url.includes("/teams?"));
  assert.equal(
    teamCall?.url,
    "http://api:8080/teams?game=rocket+league&school=example%2Funiversity&limit=25&after=next%2Bcursor&before=previous%2Fcursor"
  );
  assert.equal(teamCall?.init?.cache, "no-store");
  assert.equal(
    calls.find(({ url }) => url.endsWith("/games"))?.init?.cache,
    "no-store"
  );
  assert.equal(result.teamsUnavailable, false);
  assert.equal(result.gamesUnavailable, false);
  assert.equal(result.teams[0]?.name, "Varsity Rocket League");
  assert.deepEqual(result.games, [
    { id: "game-1", name: "Rocket League", slug: "rocket-league" }
  ]);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("owner-private-id"), false);
  assert.equal(serialized.includes("member-private-id"), false);
  assert.equal(serialized.includes("private-member@example.test"), false);
  assert.equal(serialized.includes("must-not-serialize"), false);
});

test("team and game browse failures independently degrade to bounded empty results", async () => {
  const reported: unknown[] = [];
  const result = await teamsBrowseOperation(
    { game: "", school: "", after: "", before: "" },
    {
      api: client(async () =>
        Response.json({ error: "sensitive_upstream_detail" }, { status: 503 })
      ),
      reportError: (error) => reported.push(error)
    }
  );

  assert.deepEqual(result, {
    teams: [],
    limit: 25,
    has_more: false,
    has_previous: false,
    games: [],
    gamesUnavailable: true,
    teamsUnavailable: true
  });
  assert.equal(reported.length, 2);
  assert.equal(JSON.stringify(result).includes("sensitive_upstream_detail"), false);
});

test("team detail forwards viewer cookies and returns only the minimal owner roster", async () => {
  let input: string | URL | Request | undefined;
  let init: RequestInit | undefined;
  const result = await teamDetailOperation(
    { slug: "varsity/rocket-league" },
    {
      api: client(async (requestInput, requestInit) => {
        input = requestInput;
        init = requestInit;
        return Response.json(team);
      }),
      cookieHeader: "cgn_session=server-only; unrelated=present"
    }
  );

  assert.equal(input, "http://api:8080/teams/varsity%2Frocket-league");
  assert.equal(init?.cache, "no-store");
  assert.equal(
    new Headers(init?.headers).get("cookie"),
    "cgn_session=server-only; unrelated=present"
  );
  assert.equal(result.status, "found");
  if (result.status !== "found") assert.fail("team should be found");
  assert.equal(result.viewerRole, "owner");
  assert.deepEqual(result.ownerRoster, [
    {
      user_id: "member-private-id",
      name: "Private Member",
      role: "member"
    }
  ]);
  assert.equal("owner_user_id" in result.team, false);
  assert.equal("members" in result.team, false);
  assert.equal(JSON.stringify(result).includes("server-only"), false);
  assert.equal(JSON.stringify(result).includes("private-member@example.test"), false);
});

test("team detail never returns a roster to non-owners", async () => {
  const result = await teamDetailOperation(
    { slug: "varsity-rocket-league" },
    {
      api: client(async () =>
        Response.json({ ...team, viewer_role: "member" })
      ),
      cookieHeader: "cgn_session=server-only"
    }
  );

  assert.equal(result.status, "found");
  if (result.status !== "found") assert.fail("team should be found");
  assert.equal(result.viewerRole, "member");
  assert.equal(result.ownerRoster, undefined);
  assert.equal(JSON.stringify(result).includes("member-private-id"), false);
});

test("team detail preserves exact 404 and maps other failures to a generic result", async () => {
  const missing = await teamDetailOperation(
    { slug: "missing" },
    {
      api: client(async () =>
        Response.json({ error: "team_not_found" }, { status: 404 })
      ),
      cookieHeader: ""
    }
  );
  const reported: unknown[] = [];
  const unavailable = await teamDetailOperation(
    { slug: "broken" },
    {
      api: client(async () => Response.json({ id: "broken" })),
      cookieHeader: "",
      reportError: (error) => reported.push(error)
    }
  );

  assert.deepEqual(missing, { status: "not_found" });
  assert.deepEqual(unavailable, {
    status: "error",
    message: "Team details are unavailable."
  });
  assert.equal(reported.length, 1);
});

test("team search normalization is tolerant, bounded, and preserves opaque cursors", () => {
  assert.deepEqual(
    validateTeamsSearch({
      game: [" rocket-league ", "ignored"],
      school: " example-university ",
      after: " cursor-a ",
      before: " cursor-b ",
      ignored: { nested: true }
    }),
    {
      game: "rocket-league",
      school: "example-university",
      after: "cursor-a",
      before: "cursor-b"
    }
  );
  assert.deepEqual(validateTeamsSearch({ game: "x".repeat(201), after: 7 }), {});
  assert.deepEqual(
    teamsBrowseInput({ game: "rocket-league", after: "opaque" }),
    {
      game: "rocket-league",
      school: "",
      after: "opaque",
      before: ""
    }
  );
  assert.deepEqual(validateTeamDetailSearch({ team: " joined " }), {
    team: "joined"
  });
  assert.deepEqual(validateTeamDetailSearch({ team: "raw-api-error" }), {});
});

test("team metadata is dynamic, indexable, and built from the same safe DTO", () => {
  const safeTeam = teamDtoSchema.parse(team);
  assert.deepEqual(teamRoleLabel("captain"), "Captain");
  assert.deepEqual(teamsHead("https://cgn.example").meta[0], {
    title: "Teams | Campus Gaming Network"
  });

  const metadata = teamHead(safeTeam, "https://cgn.example");
  assert.deepEqual(metadata.meta[0], {
    title: "Varsity Rocket League | Campus Gaming Network"
  });
  assert.ok(
    metadata.meta.some(
      (entry) =>
        entry.property === "og:url" &&
        entry.content ===
          "https://cgn.example/teams/varsity%2Frocket-league"
    )
  );
  assert.equal(JSON.stringify(metadata).includes("owner-private-id"), false);
  assert.equal(JSON.stringify(metadata).includes("private-member@example.test"), false);

  const createMetadata = newTeamHead("https://cgn.example");
  assert.deepEqual(createMetadata.meta[0], {
    title: "Start a team | Campus Gaming Network"
  });
  assert.ok(
    createMetadata.meta.some(
      (entry) =>
        entry.name === "robots" && entry.content === "noindex,nofollow"
    )
  );
});

const profile = {
  id: "viewer-1",
  email: "viewer@example.test",
  email_verified_at: "2037-08-01T12:00:00Z",
  verification_level: "verified_student",
  name: "Viewer",
  timezone: "America/Los_Angeles",
  home_school_id: "school-home"
};

test("new team page requires a server-derived session and bounds its catalog DTOs", async () => {
  const calls: Array<{ init?: RequestInit; url: string }> = [];
  const result = await newTeamPageOperation(
    { schoolQuery: "Example / University" },
    {
      api: client(async (input, init) => {
        const url = String(input);
        calls.push({ init, url });
        if (url.endsWith("/me")) return Response.json(profile);
        if (url.endsWith("/games")) {
          return Response.json({
            games: [
              {
                id: "game-1",
                name: "Rocket League",
                slug: "rocket-league",
                internal: "strip-me"
              }
            ]
          });
        }
        return Response.json({
          schools: [
            {
              id: "school-1",
              name: "Example University",
              slug: "example-university",
              private_notes: "strip-me"
            }
          ],
          limit: 50,
          offset: 0,
          has_more: false
        });
      }),
      cookieHeader: "cgn_session=server-only",
      sessionCookieValue: "server-only"
    }
  );

  assert.equal(result.status, "ready");
  if (result.status !== "ready") assert.fail("team page should be ready");
  assert.equal(result.defaultSchoolID, "school-home");
  assert.equal(result.games[0]?.name, "Rocket League");
  assert.equal(result.schools[0]?.name, "Example University");
  assert.equal(
    calls.find(({ url }) => url.includes("/schools?"))?.url,
    "http://api:8080/schools?q=Example+%2F+University&limit=50"
  );
  assert.ok(calls.every(({ init }) => init?.cache === "no-store"));
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("viewer@example.test"), false);
  assert.equal(serialized.includes("server-only"), false);
  assert.equal(serialized.includes("strip-me"), false);
});

test("new team page skips catalogs without a session and degrades school search only", async () => {
  let anonymousCalls = 0;
  const anonymous = await newTeamPageOperation(
    { schoolQuery: "Example" },
    {
      api: client(async () => {
        anonymousCalls += 1;
        return Response.json({});
      }),
      cookieHeader: ""
    }
  );
  assert.deepEqual(anonymous, { status: "unauthenticated" });
  assert.equal(anonymousCalls, 0);

  const reported: unknown[] = [];
  const degraded = await newTeamPageOperation(
    { schoolQuery: "Example" },
    {
      api: client(async (input) => {
        const url = String(input);
        if (url.endsWith("/me")) return Response.json(profile);
        if (url.endsWith("/games")) return Response.json({ games: [] });
        return Response.json({ error: "sensitive_detail" }, { status: 503 });
      }),
      cookieHeader: "cgn_session=server-only",
      sessionCookieValue: "server-only",
      reportError: (error) => reported.push(error)
    }
  );
  assert.deepEqual(degraded, {
    status: "ready",
    defaultSchoolID: "school-home",
    games: [],
    schools: [],
    schoolSearchFailed: true
  });
  assert.equal(reported.length, 1);
  assert.equal(JSON.stringify(degraded).includes("sensitive_detail"), false);
});

test("team write validators normalize typed and native inputs without accepting transport state", () => {
  const createForm = new FormData();
  createForm.set("name", "  Varsity Rocket League  ");
  createForm.set("description", "  Compete on campus.  ");
  createForm.set("school_id", " school-1 ");
  createForm.append("game_ids", " game-1 ");
  createForm.append("game_ids", "game-2");
  createForm.set("password", " TeamPass8 ");
  createForm.set("cookieHeader", "must-not-be-accepted");
  assert.deepEqual(validateCreateTeamServerInput(createForm), {
    valid: true,
    value: {
      name: "Varsity Rocket League",
      description: "Compete on campus.",
      school_id: "school-1",
      game_ids: ["game-1", "game-2"],
      password: "TeamPass8"
    }
  });

  const invalidJoin = new FormData();
  invalidJoin.set("slug", "varsity/rocket-league");
  invalidJoin.set("password", "short");
  assert.deepEqual(validateJoinTeamServerInput(invalidJoin), {
    valid: false,
    message: "Check the highlighted fields and try again.",
    fieldErrors: { password: ["Password must be at least 8 characters."] },
    slug: "varsity/rocket-league"
  });
  assert.equal(
    validateSetTeamCaptainServerInput({
      slug: "team-a",
      user_id: "member-a",
      captain: true,
      viewer_role: "owner"
    } as never).valid,
    true
  );
  assert.equal(
    validateTransferTeamOwnershipServerInput({
      slug: "team-a",
      new_owner_user_id: ""
    }).valid,
    false
  );
  assert.deepEqual(validateNewTeamSearch({ school_q: " Example ", team: "x" }), {
    school_q: "Example"
  });
});

test("team mutations use exact Go endpoints, request cookies, and minimal responses", async () => {
  const calls: Array<{
    body: unknown;
    cookie: string | null;
    method: string | undefined;
    url: string;
  }> = [];
  const api = client(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/me")) return Response.json(profile);
    calls.push({
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      cookie: new Headers(init?.headers).get("cookie"),
      method: init?.method,
      url
    });
    return Response.json({
      ...team,
      slug: "returned/team",
      password: "must-not-serialize"
    });
  });
  const dependencies = {
    api,
    cookieHeader: "cgn_session=server-only",
    sessionCookieValue: "server-only"
  };

  const results = await Promise.all([
    createTeamOperation(
      {
        name: "Team",
        description: "Description",
        school_id: "school-1",
        game_ids: ["game-1"],
        password: "TeamPass8"
      },
      dependencies
    ),
    joinTeamOperation(
      { slug: "team/a", password: "TeamPass8" },
      dependencies
    ),
    setTeamCaptainOperation(
      { slug: "team/a", user_id: "member-1", captain: true },
      dependencies
    ),
    transferTeamOwnershipOperation(
      { slug: "team/a", new_owner_user_id: "member-2" },
      dependencies
    )
  ]);

  assert.deepEqual(
    calls.map(({ url }) => url),
    [
      "http://api:8080/teams",
      "http://api:8080/teams/team%2Fa/join",
      "http://api:8080/teams/team%2Fa/captains",
      "http://api:8080/teams/team%2Fa/transfer-ownership"
    ]
  );
  assert.deepEqual(calls.map(({ method }) => method), [
    "POST",
    "POST",
    "POST",
    "POST"
  ]);
  assert.ok(calls.every(({ cookie }) => cookie === "cgn_session=server-only"));
  assert.deepEqual(calls[1]?.body, { password: "TeamPass8" });
  assert.deepEqual(calls[2]?.body, { user_id: "member-1", captain: true });
  assert.deepEqual(calls[3]?.body, { new_owner_user_id: "member-2" });
  assert.deepEqual(
    results.map((result) =>
      result.status === "success" ? result.redirectTo : result.status
    ),
    [
      "/teams/returned%2Fteam?team=created",
      "/teams/returned%2Fteam?team=joined",
      "/teams/returned%2Fteam?team=captain-updated",
      "/teams/returned%2Fteam?team=ownership-transferred"
    ]
  );
  assert.equal(JSON.stringify(results).includes("must-not-serialize"), false);
});

test("team writes authorize independently and leave owner checks to Go", async () => {
  let unauthenticatedCalls = 0;
  const unauthenticated = await setTeamCaptainOperation(
    { slug: "team-a", user_id: "member-a", captain: true },
    {
      api: client(async () => {
        unauthenticatedCalls += 1;
        return Response.json({});
      }),
      cookieHeader: ""
    }
  );
  assert.deepEqual(unauthenticated, {
    status: "error",
    message: "Please log in to continue."
  });
  assert.equal(unauthenticatedCalls, 0);

  const reported: unknown[] = [];
  const forbiddenCalls: string[] = [];
  const forbidden = await transferTeamOwnershipOperation(
    { slug: "team-a", new_owner_user_id: "forged-member" },
    {
      api: client(async (input) => {
        const url = String(input);
        if (url.endsWith("/me")) return Response.json(profile);
        forbiddenCalls.push(url);
        return Response.json(
          { error: "not_team_owner", detail: "private database detail" },
          { status: 403 }
        );
      }),
      cookieHeader: "cgn_session=non-owner",
      sessionCookieValue: "non-owner",
      reportError: (error) => reported.push(error)
    }
  );
  assert.deepEqual(forbidden, {
    status: "error",
    message: "Only the team owner can manage members."
  });
  assert.deepEqual(forbiddenCalls, [
    "http://api:8080/teams/team-a/transfer-ownership"
  ]);
  assert.equal(reported.length, 1);
  assert.equal(JSON.stringify(forbidden).includes("private database detail"), false);
  assert.equal(
    safeTeamMutationMessage(new Error("private response contents")),
    "Something went wrong. Please try again."
  );
});
