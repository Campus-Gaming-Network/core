import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import {
  clubDetailOperation,
  clubsBrowsePageOperation,
  schoolClubsOperation,
  submitClubClaimOperation,
  submitClubRequestOperation,
} from "../src/features/club-slice/club-operations.server.js";
import {
  clubsBrowsePageInput,
  validateClaimSearch,
  validateClubClaimServerInput,
  validateClubRequestServerInput,
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
  member_count: 2,
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

test("a claim and a request send the evidence with the session and return to their pages", async () => {
  const sent: Array<{
    url: string;
    method?: string;
    cookie: string | null;
    body: unknown;
  }> = [];
  const api = client(async (input, init) => {
    sent.push({
      url: requestURL(input),
      method: init?.method,
      cookie: new Headers(init?.headers).get("cookie"),
      body: JSON.parse(String(init?.body)),
    });
    return Response.json({ status: "pending" }, { status: 201 });
  });
  const dependencies = { api, cookieHeader: "session=abc" };

  const claim = await submitClubClaimOperation(
    {
      slug: "smash/club",
      evidence_text: "I am the president.",
      evidence_url: "",
    },
    dependencies,
  );
  const request = await submitClubRequestOperation(
    {
      school_slug: "club-university",
      name: "Chess Club",
      type: "student_club",
      evidence_text: "I am the treasurer.",
      evidence_url: "https://club.example.edu/chess",
    },
    dependencies,
  );

  assert.deepEqual(
    [claim, request],
    [
      {
        status: "success",
        redirectTo: "/clubs/smash%2Fclub/claim?claim=submitted",
      },
      {
        status: "success",
        redirectTo: "/schools/club-university/request-club?claim=submitted",
      },
    ],
  );
  assert.deepEqual(sent, [
    {
      url: "http://api:8080/clubs/smash%2Fclub/claims",
      method: "POST",
      cookie: "session=abc",
      body: { evidence_text: "I am the president.", evidence_url: "" },
    },
    {
      url: "http://api:8080/schools/club-university/club-requests",
      method: "POST",
      cookie: "session=abc",
      body: {
        name: "Chess Club",
        type: "student_club",
        evidence_text: "I am the treasurer.",
        evidence_url: "https://club.example.edu/chess",
      },
    },
  ]);
});

test("a refused claim names why, so a native post can return with the reason", async () => {
  const refuse = (status: number, error: string) =>
    submitClubClaimOperation(
      { slug: "smash-club", evidence_text: "I run it.", evidence_url: "" },
      {
        api: client(async () => Response.json({ error }, { status })),
        cookieHeader: "session=abc",
        reportError: () => {},
      },
    );

  assert.deepEqual(
    await Promise.all([
      refuse(409, "club_claim_pending"),
      refuse(409, "club_already_claimed"),
      refuse(409, "club_already_listed"),
      refuse(403, "email_verification_required"),
      refuse(500, "club_claim_failed"),
    ]),
    [
      {
        status: "error",
        outcome: "pending",
        message:
          "You already asked about this club. A site admin will review it and email you.",
      },
      {
        status: "error",
        outcome: "claimed",
        message:
          "This club is already managed by its officers. If you run it and cannot reach them, contact support.",
      },
      {
        status: "error",
        outcome: "listed",
        message:
          "A club with that name is already listed at this school. Open its page and claim it instead.",
      },
      {
        status: "error",
        outcome: "failed",
        message: "Verify your email address first, then send the form.",
      },
      {
        status: "error",
        outcome: "failed",
        message: "We could not send that. Please try again.",
      },
    ],
  );
});

test("claim and request forms are checked before they reach the API", () => {
  const claim = new FormData();
  claim.set("slug", "smash-club");
  claim.set("evidence_text", "  ");
  claim.set("evidence_url", "javascript:alert(1)");
  const request = new FormData();
  request.set("school_slug", "club-university");
  request.set("name", " Chess Club ");
  request.set("type", "guild");
  request.set("evidence_text", "I am the treasurer.");

  assert.deepEqual(validateClubClaimServerInput(claim), {
    valid: false,
    page: "/clubs/smash-club/claim",
    message: "Check the highlighted fields and try again.",
    fieldErrors: {
      evidence_text: ["Evidence is required."],
      evidence_url: ["Enter a link that starts with http:// or https://."],
    },
  });
  assert.deepEqual(validateClubRequestServerInput(request), {
    valid: false,
    page: "/schools/club-university/request-club",
    message: "Check the highlighted fields and try again.",
    fieldErrors: { type: ["Choose a club type."] },
  });
  request.set("type", "university_program");
  assert.deepEqual(validateClubRequestServerInput(request), {
    valid: true,
    value: {
      school_slug: "club-university",
      name: "Chess Club",
      type: "university_program",
      evidence_text: "I am the treasurer.",
      evidence_url: "",
    },
  });
  assert.deepEqual(
    [
      validateClaimSearch({ claim: "submitted" }),
      validateClaimSearch({ claim: "approved" }),
    ],
    [{ claim: "submitted" }, {}],
  );
});
