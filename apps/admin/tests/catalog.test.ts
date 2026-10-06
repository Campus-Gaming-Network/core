import assert from "node:assert/strict";
import test from "node:test";
import {
  approvedLogoURL,
  catalogAuditPageSchema,
  hasRecentStepUp,
  maximumLogoBytes,
  safeReturnPath,
  validateCatalogCommandInput,
  validateCatalogSearch,
  validateGameImportInput,
  validateLogoUploadInput,
  validateSchoolFormInput,
  type CatalogCommandInput,
} from "../src/features/catalog/contracts.js";
import {
  getGameDetailOperation,
  importGameOperation,
  runCatalogCommandOperation,
  searchIGDBOperation,
  saveSchoolOperation,
  uploadSchoolLogoOperation,
} from "../src/features/catalog/catalog-operations.server.js";
import { AdminApiError, type ApiClient } from "../src/server/api.server.js";

const schoolID = "11111111-1111-4111-8111-111111111111";
const userID = "22222222-2222-4222-8222-222222222222";
const grantID = "33333333-3333-4333-8333-333333333333";
const version = "2026-09-20T12:00:00Z";
const currentVersion = "2026-09-20T12:05:00Z";

function recordingApi(
  respond: (options: { path: string; method?: string }) => unknown = () => ({}),
) {
  const calls: Array<{ path: string; method?: string; body?: unknown }> = [];
  const api = (async (options) => {
    calls.push({
      path: options.path,
      method: options.method,
      body: options.body,
    });
    const data = respond(options);
    if (data instanceof Error) throw data;
    return { data, response: Response.json({}) };
  }) as ApiClient;
  return { api, calls };
}

const mutation = { cookieHeader: "admin", headers: {} };

test("school forms convert text fields into the typed API record", () => {
  const form = new FormData();
  for (const [name, value] of Object.entries({
    id: schoolID,
    expected_updated_at: version,
    unitid: "123456",
    name: " Example University ",
    alias: "EU",
    slug: "example-university",
    city: "Irvine",
    state: "CA",
    zip: "92617",
    website_url: "https://example.edu",
    latitude: "33.64",
    longitude: "-117.84",
    is_main_campus: "on",
    num_branches: "2",
    reason: "Correct the campus name",
  })) {
    form.set(name, value);
  }

  assert.deepEqual(validateSchoolFormInput(form), {
    valid: true,
    value: {
      id: schoolID,
      expected_updated_at: version,
      unitid: 123456,
      name: "Example University",
      alias: "EU",
      slug: "example-university",
      city: "Irvine",
      state: "CA",
      zip: "92617",
      website_url: "https://example.edu",
      latitude: 33.64,
      longitude: -117.84,
      is_main_campus: true,
      num_branches: 2,
      reason: "Correct the campus name",
    },
  });
});

test("school forms reject a lone coordinate, a bad slug, and a missing reason", () => {
  const result = validateSchoolFormInput({
    id: "",
    expected_updated_at: "",
    name: "Example",
    slug: "Not A Slug",
    latitude: "33",
    num_branches: "0",
  });

  assert.equal(result.valid, false);
  if (result.valid) return;
  assert.deepEqual(result.fieldErrors, {
    slug: ["Use lowercase letters, numbers, and single hyphens."],
    reason: ["Give a reason for the audit log."],
    longitude: ["Enter both coordinates, or leave both blank."],
  });
});

test("commands require a reason, a version, and confirmation where defined", () => {
  const base = {
    command: "school.delete",
    id: schoolID,
    expected_updated_at: version,
    reason: "Duplicate record",
  };

  const unconfirmed = validateCatalogCommandInput(base);
  assert.equal(unconfirmed.valid, false);
  if (!unconfirmed.valid) {
    assert.deepEqual(unconfirmed.fieldErrors, {
      confirmed: ["Confirm that you intend to make this change."],
    });
  }

  assert.equal(
    validateCatalogCommandInput({ ...base, confirmed: "on" }).valid,
    true,
  );
  // A first school-admin grant has no version to send; a restore does.
  assert.equal(
    validateCatalogCommandInput({
      command: "school_grant.grant",
      id: schoolID,
      user_id: userID,
      reason: "Esports coordinator",
    }).valid,
    true,
  );
  const reactivate = validateCatalogCommandInput({
    command: "school.reactivate",
    id: schoolID,
    reason: "Restored",
  });
  assert.equal(reactivate.valid, false);
  if (!reactivate.valid) {
    assert.deepEqual(reactivate.fieldErrors, {
      expected_updated_at: ["Reload the page and try again."],
    });
  }
});

test("each command calls its named Admin API operation and returns to its page", async () => {
  const cases: Array<{
    input: Partial<CatalogCommandInput> & Pick<CatalogCommandInput, "command">;
    request: { path: string; method: string; body: unknown };
    redirectTo: string;
  }> = [
    {
      input: { command: "school.deactivate" },
      request: {
        path: `/admin/v1/schools/${schoolID}/deactivate`,
        method: "POST",
        body: { expected_updated_at: version, reason: "Reason" },
      },
      redirectTo: `/schools/${schoolID}?notice=deactivated`,
    },
    {
      input: { command: "school.delete" },
      request: {
        path: `/admin/v1/schools/${schoolID}`,
        method: "DELETE",
        body: { expected_updated_at: version, reason: "Reason" },
      },
      redirectTo: `/schools/${schoolID}?notice=deleted`,
    },
    {
      input: { command: "school.logo_remove" },
      request: {
        path: `/admin/v1/schools/${schoolID}/logo`,
        method: "DELETE",
        body: { expected_updated_at: version, reason: "Reason" },
      },
      redirectTo: `/schools/${schoolID}?notice=logo-removed`,
    },
    {
      input: {
        command: "school_grant.grant",
        user_id: userID,
        expected_updated_at: "",
      },
      request: {
        path: `/admin/v1/schools/${schoolID}/admin-grants`,
        method: "POST",
        body: { reason: "Reason", user_id: userID },
      },
      redirectTo: `/schools/${schoolID}?notice=grant-added`,
    },
    {
      input: { command: "school_grant.revoke", grant_id: grantID },
      request: {
        path: `/admin/v1/schools/${schoolID}/admin-grants/${grantID}/revoke`,
        method: "POST",
        body: { expected_updated_at: version, reason: "Reason" },
      },
      redirectTo: `/schools/${schoolID}?notice=grant-revoked`,
    },
    {
      input: { command: "game.refresh" },
      request: {
        path: `/admin/v1/games/${schoolID}/refresh`,
        method: "POST",
        body: { expected_updated_at: version, reason: "Reason" },
      },
      redirectTo: `/games/${schoolID}?notice=refreshed`,
    },
    {
      input: { command: "user.trust", staff_faculty: "true" },
      request: {
        path: `/admin/v1/users/${schoolID}/trust-grants`,
        method: "PATCH",
        body: {
          expected_updated_at: version,
          reason: "Reason",
          staff_faculty: true,
        },
      },
      redirectTo: `/users/${schoolID}?notice=trust-changed`,
    },
    {
      input: { command: "site_grant.grant", id: userID, user_id: userID },
      request: {
        path: "/admin/v1/site-admin-grants",
        method: "POST",
        body: {
          expected_updated_at: version,
          reason: "Reason",
          user_id: userID,
        },
      },
      redirectTo: `/users/${userID}?notice=site-admin-granted`,
    },
    {
      input: { command: "site_grant.revoke", id: grantID },
      request: {
        path: `/admin/v1/site-admin-grants/${grantID}/revoke`,
        method: "POST",
        body: { expected_updated_at: version, reason: "Reason" },
      },
      redirectTo: "/access/site-admins?notice=site-admin-revoked",
    },
  ];

  await Promise.all(
    cases.map(async ({ input, request, redirectTo }) => {
      const { api, calls } = recordingApi();
      const result = await runCatalogCommandOperation(
        {
          id: schoolID,
          grant_id: "",
          user_id: "",
          user_email: "",
          expected_updated_at: version,
          staff_faculty: "",
          confirmed: true,
          reason: "Reason",
          ...input,
        },
        { api, ...mutation },
      );
      assert.deepEqual(
        { result, calls },
        { result: { status: "success", redirectTo }, calls: [request] },
        input.command,
      );
    }),
  );
});

test("commands route step-up, ended sessions, conflicts, and dependency errors", async () => {
  const command: CatalogCommandInput = {
    command: "user.suspend",
    id: userID,
    grant_id: "",
    user_id: "",
    user_email: "",
    expected_updated_at: version,
    staff_faculty: "",
    confirmed: true,
    reason: "Abuse report confirmed",
  };
  const outcomes = await Promise.all(
    [
      new AdminApiError(403, "recent_auth_required"),
      new AdminApiError(401, "admin_session_required"),
      new AdminApiError(409, "catalog_dependencies_exist"),
    ].map((error) =>
      runCatalogCommandOperation(command, {
        api: recordingApi(() => error).api,
        ...mutation,
      }),
    ),
  );
  assert.deepEqual(outcomes, [
    {
      status: "step-up-required",
      redirectTo: `/step-up?return=${encodeURIComponent(`/users/${userID}`)}`,
    },
    { status: "session-ended" },
    {
      status: "error",
      message:
        "This record is still referenced by events, teams, follows, or grants. Deactivate it instead.",
    },
  ]);

  const { api, calls } = recordingApi(({ method }) =>
    method === "POST"
      ? new AdminApiError(409, "admin_record_conflict")
      : { updated_at: currentVersion },
  );
  const conflict = await runCatalogCommandOperation(command, {
    api,
    ...mutation,
  });
  assert.deepEqual(conflict, {
    status: "error",
    message:
      "This record changed after you opened it. Your entries are still in the form; review the current page, then submit again.",
    currentUpdatedAt: currentVersion,
  });
  assert.deepEqual(
    calls.map(({ path, method }) => ({ path, method })),
    [
      { path: `/admin/v1/users/${userID}/suspend`, method: "POST" },
      { path: `/admin/v1/users/${userID}`, method: undefined },
    ],
  );
});

test("creating a school sends the record without a version", async () => {
  const { api, calls } = recordingApi(() => ({ id: schoolID }));
  const result = await saveSchoolOperation(
    {
      id: "",
      expected_updated_at: "",
      unitid: null,
      name: "Example University",
      alias: "",
      slug: "example-university",
      city: "",
      state: "",
      zip: "",
      website_url: "",
      latitude: null,
      longitude: null,
      is_main_campus: true,
      num_branches: 0,
      reason: "New campus",
    },
    { api, ...mutation },
  );

  assert.deepEqual(
    { result, calls },
    {
      result: {
        status: "success",
        redirectTo: `/schools/${schoolID}?notice=created`,
      },
      calls: [
        {
          path: "/admin/v1/schools",
          method: "POST",
          body: {
            unitid: null,
            name: "Example University",
            alias: "",
            slug: "example-university",
            city: "",
            state: "",
            zip: "",
            website_url: "",
            latitude: null,
            longitude: null,
            is_main_campus: true,
            num_branches: 0,
            reason: "New campus",
          },
        },
      ],
    },
  );
});

test("audit entries reach the browser as changed field names and a reason", () => {
  assert.deepEqual(
    catalogAuditPageSchema.parse({
      audit_entries: [
        {
          id: grantID,
          actor_user_id: userID,
          admin_session_id: schoolID,
          action: "user.suspended",
          entity_type: "user",
          entity_id: userID,
          before: { account_status: "active", email: "private@example.test" },
          after: { account_status: "suspended", email: "private@example.test" },
          metadata: { operator_reason: "Abuse", operator_identity: "op" },
          created_at: version,
        },
      ],
      next_cursor: "",
      previous_cursor: "",
    }),
    {
      audit_entries: [
        {
          id: grantID,
          actor_user_id: userID,
          action: "user.suspended",
          created_at: version,
          reason: "Abuse",
          changed_fields: ["account_status"],
        },
      ],
      next_cursor: "",
      previous_cursor: "",
    },
  );
});

test("searches accept only each list's states and one cursor direction", () => {
  assert.deepEqual(
    validateCatalogSearch("users")({ q: " ab ", state: "suspended" }),
    { q: "ab", state: "suspended" },
  );
  assert.deepEqual(
    validateCatalogSearch("users")({
      q: "a",
      state: "inactive",
      after: "x",
      before: "y",
    }),
    {},
  );
});

test("step-up returns stay on this app and last ten minutes", () => {
  assert.equal(safeReturnPath(`/users/${userID}`), `/users/${userID}`);
  for (const unsafe of [
    "//evil.example",
    "/\\evil.example",
    "https://evil.example",
    "users",
    "",
  ]) {
    assert.equal(safeReturnPath(unsafe), "/", unsafe);
  }

  const stepUpAt = "2026-09-20T12:00:00Z";
  const start = Date.parse(stepUpAt);
  assert.equal(hasRecentStepUp(stepUpAt, start + 9 * 60_000), true);
  assert.equal(hasRecentStepUp(stepUpAt, start + 10 * 60_000), false);
  assert.equal(hasRecentStepUp(undefined, start), false);
});

test("logo uploads need a version, a reason, and a file within 5 MB", () => {
  const form = new FormData();
  form.set("id", schoolID);
  form.set("expected_updated_at", version);
  form.set("reason", " Official logo ");
  const file = new File([new Uint8Array(8)], "logo.gif", { type: "text/html" });
  form.set("file", file);
  assert.deepEqual(validateLogoUploadInput(form), {
    valid: true,
    value: {
      id: schoolID,
      expected_updated_at: version,
      reason: "Official logo",
      file,
    },
  });

  const missing = new FormData();
  missing.set("id", schoolID);
  missing.set("expected_updated_at", version);
  assert.deepEqual(validateLogoUploadInput(missing), {
    valid: false,
    id: schoolID,
    message: "Check the highlighted fields and try again.",
    fieldErrors: {
      reason: ["Give a reason for the audit log."],
      file: ["Choose a PNG or JPEG file."],
    },
  });

  form.set("file", new File([new Uint8Array(maximumLogoBytes + 1)], "big.png"));
  assert.deepEqual(validateLogoUploadInput(form), {
    valid: false,
    id: schoolID,
    message: "Check the highlighted fields and try again.",
    fieldErrors: {
      file: [
        "The file is larger than 5 MB. Export a smaller PNG or JPEG and try again.",
      ],
    },
    notice: "logo-too-large",
  });
});

test("an upload forwards only the bytes, version, and reason", async () => {
  const { api, calls } = recordingApi(() => ({ id: schoolID }));
  const result = await uploadSchoolLogoOperation(
    {
      id: schoolID,
      expected_updated_at: version,
      reason: "Official logo",
      file: new File(["png-bytes"], "../evil.svg", { type: "image/svg+xml" }),
    },
    { api, ...mutation },
  );
  const [call] = calls;
  const body = call?.body as FormData;
  const file = body.get("file") as File;
  assert.deepEqual(
    {
      result,
      path: call?.path,
      method: call?.method,
      fields: [...body.keys()],
      reason: body.get("reason"),
      version: body.get("expected_updated_at"),
      file: { name: file.name, type: file.type, text: await file.text() },
    },
    {
      result: {
        status: "success",
        redirectTo: `/schools/${schoolID}?notice=logo-updated`,
      },
      path: `/admin/v1/schools/${schoolID}/logo`,
      method: "POST",
      fields: ["expected_updated_at", "reason", "file"],
      reason: "Official logo",
      version,
      file: { name: "logo", type: "", text: "png-bytes" },
    },
  );
});

test("rejected logos explain the reason and name a no-JavaScript notice", async () => {
  const outcomes = await Promise.all(
    [
      new AdminApiError(413, "logo_too_large"),
      new AdminApiError(415, "logo_unsupported_type"),
      new AdminApiError(422, "logo_invalid_image"),
      new AdminApiError(422, "logo_dimensions_exceeded"),
      new AdminApiError(429, "rate_limited"),
      new AdminApiError(503, "logo_storage_unavailable"),
    ].map((error) =>
      uploadSchoolLogoOperation(
        {
          id: schoolID,
          expected_updated_at: version,
          reason: "Official logo",
          file: new File(["x"], "logo.png"),
        },
        { api: recordingApi(() => error).api, ...mutation },
      ),
    ),
  );
  assert.deepEqual(outcomes, [
    {
      status: "error",
      message:
        "The file is larger than 5 MB. Export a smaller PNG or JPEG and try again.",
      notice: "logo-too-large",
    },
    {
      status: "error",
      message:
        "Upload a PNG or JPEG image. SVG, GIF, WebP, and animated images are not accepted.",
      notice: "logo-unsupported",
    },
    {
      status: "error",
      message:
        "The file could not be read as a complete PNG or JPEG image. Export it again and retry.",
      notice: "logo-invalid",
    },
    {
      status: "error",
      message:
        "The image is larger than 4096 × 4096 pixels or 16 megapixels. Resize it and try again.",
      notice: "logo-dimensions",
    },
    {
      status: "error",
      message: "Too many attempts. Wait up to 15 minutes, then try again.",
      notice: "rate-limited",
    },
    {
      status: "error",
      message: "Logo storage is unavailable right now. Try again later.",
    },
  ]);
});

test("only API-generated keys under the asset origin render as logos", () => {
  const base = "https://assets.example.test";
  const key = `school-logos/${schoolID}/${"a1".repeat(16)}.png`;
  assert.equal(approvedLogoURL(`${base}/${key}`, base), `${base}/${key}`);
  for (const unsafe of [
    `https://assets.example.test.evil.example/${key}`,
    `https://evil.example/${key}`,
    `javascript:alert(1)//${base}/${key}`,
    `${base}/school-logos/../${key}`,
    `${base}/${key}?download=1`,
    `${base}/${key.replace(".png", ".svg")}`,
    "",
  ]) {
    assert.equal(approvedLogoURL(unsafe, base), "", unsafe);
  }
  assert.equal(approvedLogoURL(`${base}/${key}`, undefined), "");
});

test("a school-admin grant resolves the exact email to its account", async () => {
  const input: CatalogCommandInput = {
    command: "school_grant.grant",
    id: schoolID,
    grant_id: "",
    user_id: "",
    user_email: "ada@example.test",
    expected_updated_at: "",
    staff_faculty: "",
    confirmed: true,
    reason: "Club advisor",
  };
  const users = [
    { id: grantID, email: "ada@example.test.other" },
    { id: userID, email: "Ada@example.test" },
  ];

  const found = recordingApi(() => ({ users }));
  assert.deepEqual(
    {
      result: await runCatalogCommandOperation(input, {
        api: found.api,
        ...mutation,
      }),
      calls: found.calls,
    },
    {
      result: {
        status: "success",
        redirectTo: `/schools/${schoolID}?notice=grant-added`,
      },
      calls: [
        {
          path: "/admin/v1/users?limit=25&q=ada%40example.test",
          method: undefined,
          body: undefined,
        },
        {
          path: `/admin/v1/schools/${schoolID}/admin-grants`,
          method: "POST",
          body: { reason: "Club advisor", user_id: userID },
        },
      ],
    },
  );

  const missing = recordingApi(() => ({ users: users.slice(0, 1) }));
  assert.deepEqual(
    await runCatalogCommandOperation(input, { api: missing.api, ...mutation }),
    {
      status: "error",
      message: "Check the highlighted fields and try again.",
      fieldErrors: { user_email: ["No account uses that email address."] },
    },
  );
});

const importedGame = {
  id: schoolID,
  name: "Rocket League",
  slug: "rocket-league",
  is_active: false,
  created_at: version,
  updated_at: version,
  deleted_at: null,
  igdb_id: 11198,
  last_synced_at: version,
  has_cover: true,
};

test("an import names only the IGDB entry and a reason", async () => {
  const form = new FormData();
  form.set("igdb_id", "11198");
  form.set("reason", " Requested by schools ");
  form.set("name", "Ignored: the API reads the name from IGDB");
  assert.deepEqual(validateGameImportInput(form), {
    valid: true,
    value: { igdb_id: 11198, reason: "Requested by schools" },
  });
  assert.deepEqual(validateGameImportInput({ igdb_id: "", reason: "" }), {
    valid: false,
    id: "",
    message: "Check the highlighted fields and try again.",
    fieldErrors: {
      igdb_id: ["Choose a game to import."],
      reason: ["Give a reason for the audit log."],
    },
  });

  const { api, calls } = recordingApi(() => importedGame);
  const result = await importGameOperation(
    { igdb_id: 11198, reason: "Requested by schools" },
    { api, ...mutation },
  );
  assert.deepEqual(
    { result, calls },
    {
      result: {
        status: "success",
        redirectTo: `/games/${schoolID}?notice=imported`,
      },
      calls: [
        {
          path: "/admin/v1/game-imports",
          method: "POST",
          body: { igdb_id: 11198, reason: "Requested by schools" },
        },
      ],
    },
  );
});

test("IGDB failures explain themselves and name a no-JavaScript notice", async () => {
  const outcomes = await Promise.all(
    [
      new AdminApiError(409, "game_already_imported"),
      new AdminApiError(503, "igdb_not_configured"),
      new AdminApiError(503, "igdb_rate_limited"),
      new AdminApiError(502, "igdb_unavailable"),
    ].map((error) =>
      importGameOperation(
        { igdb_id: 11198, reason: "Requested by schools" },
        { api: recordingApi(() => error).api, ...mutation },
      ),
    ),
  );
  assert.deepEqual(outcomes, [
    {
      status: "error",
      message: "That game is already in the catalog.",
      notice: "already-imported",
    },
    {
      status: "error",
      message:
        "IGDB is not configured for this environment. Set the IGDB credentials on the API.",
      notice: "igdb-not-configured",
    },
    {
      status: "error",
      message: "IGDB is limiting requests right now. Try again shortly.",
      notice: "igdb-rate-limited",
    },
    {
      status: "error",
      message: "IGDB could not be reached. Try again later.",
      notice: "igdb-unavailable",
    },
  ]);
});

test("an IGDB search skips short queries and reports an outage as a message", async () => {
  const matches = [
    { igdb_id: 11198, name: "Rocket League", release_year: 2015 },
    { igdb_id: 7, name: "Rocket Arena", game_id: schoolID },
  ];
  const found = recordingApi(() => ({ games: matches }));
  const down = recordingApi(() => new AdminApiError(502, "igdb_unavailable"));
  const read = { cookieHeader: "admin" };
  assert.deepEqual(
    {
      short: await searchIGDBOperation("r", { api: found.api, ...read }),
      found: await searchIGDBOperation("rocket & co", {
        api: found.api,
        ...read,
      }),
      down: await searchIGDBOperation("rocket", { api: down.api, ...read }),
      calls: found.calls,
    },
    {
      short: { query: "r", games: [] },
      found: { query: "rocket & co", games: matches },
      down: {
        query: "rocket",
        games: [],
        error: "IGDB could not be reached. Try again later.",
      },
      calls: [
        {
          path: "/admin/v1/igdb-games?q=rocket+%26+co",
          method: undefined,
          body: undefined,
        },
      ],
    },
  );
});

test("a stored cover reaches the page as a data URL", async () => {
  const { api, calls } = recordingApi(({ path }) =>
    path.endsWith("/cover")
      ? { content_type: "image/jpeg", data: "/9j/4A==" }
      : path.includes("/audit")
        ? { audit_entries: [], next_cursor: "", previous_cursor: "" }
        : importedGame,
  );
  const detail = await getGameDetailOperation(
    { id: schoolID },
    { api, cookieHeader: "admin" },
  );
  assert.deepEqual(
    { coverImage: detail.coverImage, paths: calls.map((call) => call.path) },
    {
      coverImage: "data:image/jpeg;base64,/9j/4A==",
      paths: [
        `/admin/v1/games/${schoolID}`,
        `/admin/v1/games/${schoolID}/audit?limit=25`,
        `/admin/v1/games/${schoolID}/cover`,
      ],
    },
  );
});
