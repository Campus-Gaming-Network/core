import assert from "node:assert/strict";
import test from "node:test";
import {
  catalogAuditPageSchema,
  validateCatalogSearch,
  validateClubFormInput,
  validateClubLinksInput,
} from "../src/features/catalog/contracts.js";
import {
  runCatalogCommandOperation,
  saveClubLinksOperation,
  saveClubOperation,
} from "../src/features/catalog/catalog-operations.server.js";
import type { ApiClient } from "../src/server/api.server.js";

const schoolID = "11111111-1111-4111-8111-111111111111";
const clubID = "44444444-4444-4444-8444-444444444444";
const valorantID = "55555555-5555-4555-8555-555555555555";
const leagueID = "66666666-6666-4666-8666-666666666666";
const version = "2026-09-20T12:00:00Z";
const mutation = { cookieHeader: "admin", headers: {} };

function form(fields: Record<string, string | string[]>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    for (const item of [value].flat()) data.append(name, item);
  }
  return data;
}

function recordingApi(respond: (path: string) => unknown) {
  const calls: Array<{ path: string; method?: string; body?: unknown }> = [];
  const api = (async (options) => {
    calls.push({
      path: options.path,
      method: options.method,
      body: options.body,
    });
    return { data: respond(options.path), response: Response.json({}) };
  }) as ApiClient;
  return { api, calls };
}

const club = {
  id: clubID,
  name: "Esports Program",
  slug: "esports-program",
  type: "university_program",
  summary: "",
  how_to_join: "",
  school: { id: schoolID, name: "Club University", slug: "club-university" },
  games: [],
  links: [],
  is_active: true,
  confirmed_at: null,
  confirmed_source: null,
  created_at: version,
  updated_at: version,
  deleted_at: null,
};

const game = (id: string, name: string, slug: string) => ({
  id,
  name,
  slug,
  is_active: true,
  created_at: version,
  updated_at: version,
  deleted_at: null,
  igdb_id: null,
  last_synced_at: null,
  has_cover: false,
  user_submitted: false,
});

test("the club form: a new club names its school, an edit names its version", () => {
  const fields = {
    name: " Esports Program ",
    slug: "esports-program",
    type: "university_program",
    summary: "Varsity rosters.",
    how_to_join: "Tryouts in September.",
    game_ids: [valorantID, valorantID],
    add_games: " League of Legends,  , Valorant ",
    reason: "Listed on the university's site",
  };
  const created = validateClubFormInput(
    form({ ...fields, id: "", expected_updated_at: "", school_id: schoolID }),
  );
  const edited = validateClubFormInput(
    form({
      ...fields,
      id: clubID,
      expected_updated_at: version,
      school_id: "",
    }),
  );
  const noSchool = validateClubFormInput(
    form({ ...fields, id: "", expected_updated_at: "", school_id: "" }),
  );
  const badType = validateClubFormInput(
    form({
      ...fields,
      type: "official",
      id: "",
      expected_updated_at: "",
      school_id: schoolID,
    }),
  );

  const value = {
    name: "Esports Program",
    slug: "esports-program",
    type: "university_program",
    summary: "Varsity rosters.",
    how_to_join: "Tryouts in September.",
    game_ids: [valorantID],
    add_games: ["League of Legends", "Valorant"],
    reason: "Listed on the university's site",
  };
  assert.deepEqual(
    {
      created,
      edited,
      noSchool: noSchool.valid,
      badType: badType.valid ? undefined : badType.fieldErrors.type,
    },
    {
      created: {
        valid: true,
        value: {
          ...value,
          id: "",
          expected_updated_at: "",
          school_id: schoolID,
        },
      },
      edited: {
        valid: true,
        value: {
          ...value,
          id: clubID,
          expected_updated_at: version,
          school_id: "",
        },
      },
      noSchool: false,
      badType: ["Choose student club or university program."],
    },
  );
});

test("saving a club matches typed game names to the catalog", async () => {
  const { api, calls } = recordingApi((path) =>
    path.startsWith("/admin/v1/games")
      ? {
          games: path.toLowerCase().includes("league")
            ? [
                game(leagueID, "League of Legends", "league-of-legends"),
                game(valorantID, "League of Legends: Wild Rift", "wild-rift"),
              ]
            : [],
          next_cursor: "",
          previous_cursor: "",
        }
      : club,
  );
  const input = {
    id: "" as const,
    expected_updated_at: "" as const,
    school_id: schoolID,
    name: "Esports Program",
    slug: "esports-program",
    type: "university_program" as const,
    summary: "",
    how_to_join: "Tryouts in September.",
    game_ids: [valorantID],
    reason: "Listed on the university's site",
  };

  const saved = await saveClubOperation(
    { ...input, add_games: ["league of legends"] },
    { api, ...mutation },
  );
  const unknown = await saveClubOperation(
    { ...input, add_games: ["Not A Game"] },
    { api, ...mutation },
  );

  assert.deepEqual(
    {
      saved,
      create: calls.find((call) => call.path === "/admin/v1/clubs"),
      unknown,
    },
    {
      saved: {
        status: "success",
        redirectTo: `/clubs/${clubID}?notice=created`,
      },
      create: {
        path: "/admin/v1/clubs",
        method: "POST",
        body: {
          name: "Esports Program",
          slug: "esports-program",
          type: "university_program",
          summary: "",
          how_to_join: "Tryouts in September.",
          game_ids: [valorantID, leagueID],
          reason: "Listed on the university's site",
          school_id: schoolID,
        },
      },
      unknown: {
        status: "error",
        message: "Check the highlighted fields and try again.",
        fieldErrors: {
          add_games: ["No game in the catalog is named Not A Game."],
        },
      },
    },
  );
});

test("the links form keeps filled rows in order and names a bad row's field", async () => {
  const valid = validateClubLinksInput(
    form({
      id: clubID,
      expected_updated_at: version,
      reason: "Fix links",
      link_type_0: "discord",
      link_label_0: " Discord ",
      link_url_0: "https://discord.example.test/club",
      link_type_1: "website",
      link_label_1: "",
      link_url_1: "",
      link_type_2: "website",
      link_label_2: "Site",
      link_url_2: "https://club.example.test",
    }),
  );
  const invalid = validateClubLinksInput(
    form({
      id: clubID,
      expected_updated_at: version,
      reason: "Fix links",
      link_type_0: "website",
      link_label_0: "Site",
      link_url_0: "javascript:alert(1)",
    }),
  );
  const links = [
    {
      type: "discord",
      label: "Discord",
      url: "https://discord.example.test/club",
    },
    { type: "website", label: "Site", url: "https://club.example.test" },
  ];
  assert.deepEqual(
    {
      valid,
      invalid: invalid.valid ? undefined : invalid.fieldErrors,
    },
    {
      valid: {
        valid: true,
        value: {
          id: clubID,
          expected_updated_at: version,
          links,
          reason: "Fix links",
        },
      },
      invalid: { link_url_0: ["Enter an http or https URL."] },
    },
  );

  const { api, calls } = recordingApi(() => club);
  const result = await saveClubLinksOperation(
    {
      id: clubID,
      expected_updated_at: version,
      links: links as never,
      reason: "Fix links",
    },
    { api, ...mutation },
  );
  assert.deepEqual(
    { result, calls },
    {
      result: {
        status: "success",
        redirectTo: `/clubs/${clubID}?notice=links-saved`,
      },
      calls: [
        {
          path: `/admin/v1/clubs/${clubID}/links`,
          method: "POST",
          body: { links, reason: "Fix links", expected_updated_at: version },
        },
      ],
    },
  );
});

test("hide, publish, and mark as checked call their named operations", async () => {
  const results = await Promise.all(
    (["club.hide", "club.unhide", "club.check"] as const).map(
      async (command) => {
        const { api, calls } = recordingApi(() => club);
        const result = await runCatalogCommandOperation(
          {
            command,
            id: clubID,
            grant_id: "",
            user_id: "",
            user_email: "",
            expected_updated_at: version,
            staff_faculty: "",
            confirmed: true,
            reason: "Reason",
          },
          { api, ...mutation },
        );
        return { result, path: calls[0]?.path };
      },
    ),
  );
  assert.deepEqual(results, [
    {
      result: {
        status: "success",
        redirectTo: `/clubs/${clubID}?notice=club-hidden`,
      },
      path: `/admin/v1/clubs/${clubID}/hide`,
    },
    {
      result: {
        status: "success",
        redirectTo: `/clubs/${clubID}?notice=club-published`,
      },
      path: `/admin/v1/clubs/${clubID}/unhide`,
    },
    {
      result: {
        status: "success",
        redirectTo: `/clubs/${clubID}?notice=club-checked`,
      },
      path: `/admin/v1/clubs/${clubID}/mark-checked`,
    },
  ]);
});

test("the clubs list keeps a school filter and club audit entries read", () => {
  assert.deepEqual(
    [
      validateCatalogSearch("clubs")({ school: schoolID, state: "inactive" }),
      validateCatalogSearch("clubs")({ school: "not-an-id" }),
      validateCatalogSearch("schools")({ school: schoolID }),
    ],
    [
      { school: schoolID, state: "inactive" },
      { school: undefined },
      { school: undefined },
    ],
  );
  const entries = catalogAuditPageSchema.parse({
    audit_entries: [
      {
        id: clubID,
        action: "club.updated",
        before: { slug: "old" },
        after: { slug: "new" },
        metadata: { operator_reason: "Rename", edited_fields: ["name"] },
        created_at: version,
      },
    ],
    next_cursor: "",
    previous_cursor: "",
  }).audit_entries;
  assert.deepEqual(
    entries.map(({ action, reason, changed_fields }) => ({
      action,
      reason,
      changed_fields,
    })),
    [
      {
        action: "club.updated",
        reason: "Rename",
        changed_fields: ["slug", "name"],
      },
    ],
  );
});
