import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import {
  clubDetailOperation,
  clubsBrowsePageOperation,
  schoolClubsOperation,
} from "../src/features/club-slice/club-operations.server.js";
import {
  clubsBrowsePageInput,
  validateClubsSearch,
} from "../src/features/club-slice/contracts.js";
import {
  clubConfirmedLine,
  clubManagedBy,
} from "../src/features/club-slice/presentation.js";
import { createApiClient, type Fetcher } from "../src/server/api.server.js";
import { requestURL } from "./fetch-stub.js";

function client(fetcher: Fetcher) {
  return createApiClient({ baseUrl: "http://api:8080", fetcher });
}

const club = {
  id: "club-1",
  name: "Esports Program",
  slug: "esports-program",
  type: "university_program",
  summary: "Varsity rosters for three titles.",
  how_to_join: "Tryouts each September.",
  school: { id: "school-1", name: "Club University", slug: "club/university" },
  games: [
    { id: "game-1", name: "Valorant", slug: "valorant", has_cover: true },
  ],
  links: [
    { type: "discord", label: "Discord", url: "https://discord.example.test" },
  ],
  claimed: false,
  confirmed_at: "2031-03-04T12:00:00Z",
  confirmed_source: "cgn",
};

test("a club page reads one club, and a hidden or missing club is not found", async () => {
  const requested: string[] = [];
  const found = await clubDetailOperation(
    { slug: "esports/program" },
    {
      api: client(async (input) => {
        requested.push(requestURL(input));
        return Response.json({ ...club, internal_note: "strip" });
      }),
    },
  );
  const hidden = await clubDetailOperation(
    { slug: "hidden-guild" },
    {
      api: client(async () =>
        Response.json({ error: "club_not_found" }, { status: 404 }),
      ),
    },
  );
  const reported: unknown[] = [];
  const failed = await clubDetailOperation(
    { slug: "esports-program" },
    {
      api: client(async () =>
        Response.json({ error: "club_unavailable" }, { status: 503 }),
      ),
      reportError: (error) => reported.push(error),
    },
  );

  assert.deepEqual(
    { found, hidden, failed, requested, reported: reported.length },
    {
      found: { status: "found", club },
      hidden: { status: "not_found" },
      failed: { status: "error" },
      requested: ["http://api:8080/clubs/esports%2Fprogram"],
      reported: 1,
    },
  );
});

test("a link that is not http or https never reaches the page", async () => {
  const result = await clubDetailOperation(
    { slug: "esports-program" },
    {
      api: client(async () =>
        Response.json({
          ...club,
          links: [
            { type: "website", label: "Site", url: "javascript:alert(1)" },
          ],
        }),
      ),
      reportError: () => {},
    },
  );

  assert.deepEqual(result, { status: "error" });
});

test("a school page lists its clubs, and a failure leaves the page up", async () => {
  const requested: string[] = [];
  const listed = await schoolClubsOperation(
    { slug: "club/university" },
    {
      api: client(async (input) => {
        requested.push(requestURL(input));
        return Response.json({
          clubs: [
            {
              id: club.id,
              name: club.name,
              slug: club.slug,
              type: club.type,
              summary: club.summary,
              games: club.games,
              claimed: false,
            },
          ],
        });
      }),
    },
  );
  const failed = await schoolClubsOperation(
    { slug: "club-university" },
    {
      api: client(async () => {
        throw new Error("offline");
      }),
      reportError: () => {},
    },
  );

  assert.deepEqual(
    {
      requested,
      slugs: listed.clubs.map((item) => item.slug),
      unavailable: listed.unavailable,
      failed,
    },
    {
      requested: ["http://api:8080/schools/club%2Funiversity/clubs"],
      slugs: ["esports-program"],
      unavailable: false,
      failed: { clubs: [], unavailable: true },
    },
  );
});

test("a club page says who keeps it and when it was last confirmed", () => {
  assert.deepEqual(
    [
      clubManagedBy({ claimed: false }),
      clubManagedBy({ claimed: true }),
      clubConfirmedLine({
        confirmed_at: "2031-03-04T23:30:00-08:00",
        confirmed_source: "cgn",
      }),
      clubConfirmedLine({
        confirmed_at: "2031-03-04T12:00:00Z",
        confirmed_source: "club",
      }),
      clubConfirmedLine({}),
    ],
    [
      "Maintained by Campus Gaming Network",
      "Managed by the club",
      "Checked by Campus Gaming Network on Mar 5, 2031",
      "Confirmed by the club on Mar 4, 2031",
      undefined,
    ],
  );
});

test("the clubs directory keeps its filters in the query string and drops bad values", () => {
  assert.deepEqual(
    [
      validateClubsSearch({
        q: "  smash ",
        school: "club-university",
        type: "student_club",
        game: "melee",
        school_q: "club",
        after: "cursor-a",
        before: "cursor-b",
      }),
      validateClubsSearch({
        q: "x".repeat(101),
        type: "guild",
        school: ["first", "second"],
        game: 7,
      }),
      validateClubsSearch({ before: "cursor-b" }),
    ],
    [
      {
        q: "smash",
        school: "club-university",
        type: "student_club",
        game: "melee",
        school_q: "club",
        after: "cursor-a",
      },
      { school: "first" },
      { before: "cursor-b" },
    ],
  );
  assert.deepEqual(clubsBrowsePageInput({ type: "university_program" }), {
    q: "",
    school: "",
    type: "university_program",
    game: "",
    after: "",
    before: "",
    schoolQuery: "",
    gameQuery: "",
  });
});

test("the clubs directory asks for one filtered page, and a failure leaves the page up", async () => {
  const requested: string[] = [];
  const listed = await clubsBrowsePageOperation(
    {
      ...clubsBrowsePageInput({ q: "esports", type: "university_program" }),
      after: "cursor-a",
    },
    {
      api: client(async (input) => {
        requested.push(requestURL(input));
        return Response.json({
          clubs: [
            {
              id: club.id,
              name: club.name,
              slug: club.slug,
              type: club.type,
              summary: club.summary,
              games: club.games,
              claimed: false,
              school: club.school,
            },
          ],
          limit: 25,
          has_more: true,
          has_previous: true,
          next_cursor: "cursor-b",
          previous_cursor: "cursor-c",
        });
      }),
    },
  );
  const failed = await clubsBrowsePageOperation(clubsBrowsePageInput({}), {
    api: client(async () => {
      throw new Error("offline");
    }),
    reportError: () => {},
  });

  assert.deepEqual(
    {
      requested,
      slugs: listed.clubs.map((item) => item.slug),
      paging: [
        listed.has_more,
        listed.has_previous,
        listed.next_cursor,
        listed.previous_cursor,
      ],
      unavailable: [listed.clubsUnavailable, failed.clubsUnavailable],
      failedClubs: failed.clubs,
    },
    {
      requested: [
        "http://api:8080/clubs?q=esports&type=university_program&limit=25&after=cursor-a",
      ],
      slugs: ["esports-program"],
      paging: [true, true, "cursor-b", "cursor-c"],
      unavailable: [false, true],
      failedClubs: [],
    },
  );
});
