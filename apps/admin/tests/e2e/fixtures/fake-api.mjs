import http from "node:http";

const port = Number.parseInt(process.env.PORT ?? "18082", 10);
const reportID = "11111111-1111-4111-8111-111111111111";
const ticketID = "22222222-2222-4222-8222-222222222222";
const operatorID = "33333333-3333-4333-8333-333333333333";
const reporterID = "44444444-4444-4444-8444-444444444444";
const targetID = "55555555-5555-4555-8555-555555555555";
const sessionID = "66666666-6666-4666-8666-666666666666";
const createdAt = "2026-09-18T16:00:00Z";

const session = {
  user_id: operatorID,
  email: "operator@example.test",
  role: "site_admin",
  capabilities: [
    "admin.session.read",
    "reports.read",
    "reports.manage",
    "support.read",
    "support.manage",
    "schools.read",
    "schools.manage",
    "school_logos.manage",
    "school_grants.manage",
    "games.manage",
    "users.read",
    "users.manage_status",
    "trust_grants.manage",
    "site_grants.manage",
    "audit.read",
  ],
  authenticated_at: "2026-09-18T15:30:00Z",
  absolute_expires_at: "2026-09-18T23:30:00Z",
};

// Session cookies starting with "stepped-up" model an operator who confirmed
// their identity within the last ten minutes. Revoking a session's site-admin
// grant ends it, as the Go API does.
const isSteppedUp = (sessionValue) => sessionValue.startsWith("stepped-up");
const revokedSessions = new Set();

const catalogSchoolID = "88888888-8888-4888-8888-888888888888";
const catalogGameID = "99999999-9999-4999-8999-999999999999";
const memberID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const gatedMemberID = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const operatorGrantID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const peerAdminID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const peerGrantID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const catalogCreatedAt = "2026-09-20T12:00:00Z";

let schools;
let schoolsWithHistory;
let schoolGrants;
let games;
// What the fake IGDB knows. Searching for "outage" answers as an IGDB outage.
const igdbGames = [
  { igdb_id: 11198, name: "Rocket League", release_year: 2015 },
  { igdb_id: 133236, name: "Rocket Arena", release_year: 2020 },
];
// A one-pixel PNG, base64-encoded as the cover endpoint sends it.
const coverPNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
let users;
let siteGrants;
let catalogAudit;
let catalogSequence;
// Uploaded logo bytes, served from the asset path like the public R2 origin.
let logoObjects;
const assetBase = `http://127.0.0.1:${port}/assets`;

// Restores the seeded catalog so each browser test starts from the same state.
function resetCatalog() {
  schools = new Map([
    [
      catalogSchoolID,
      {
        id: catalogSchoolID,
        unitid: 123456,
        name: "Browser Test University",
        alias: "BTU",
        slug: "browser-test-university",
        city: "Irvine",
        state: "CA",
        zip: "92617",
        website_url: "https://browser.example.test",
        latitude: 33.64,
        longitude: -117.84,
        is_main_campus: true,
        num_branches: 0,
        logo_url: "",
        is_active: true,
        created_at: catalogCreatedAt,
        updated_at: catalogCreatedAt,
        deleted_at: null,
      },
    ],
  ]);
  // Schools with events, teams, follows, or grants cannot be deleted.
  schoolsWithHistory = new Set([catalogSchoolID]);
  schoolGrants = [];
  games = new Map([
    [
      catalogGameID,
      {
        id: catalogGameID,
        name: "Strategy Arena",
        slug: "strategy-arena",
        is_active: true,
        created_at: catalogCreatedAt,
        updated_at: catalogCreatedAt,
        deleted_at: null,
        igdb_id: null,
        last_synced_at: null,
        has_cover: false,
      },
    ],
  ]);
  users = new Map(
    [
      [memberID, "member@example.test", "Member Player", false],
      [gatedMemberID, "gated@example.test", "Gated Player", false],
      [operatorID, "operator@example.test", "Operator", true],
      [peerAdminID, "peer@example.test", "Peer Admin", true],
    ].map(([id, email, name, siteAdmin]) => [
      id,
      {
        id,
        email,
        name,
        home_school_id: catalogSchoolID,
        email_verified_at: catalogCreatedAt,
        verification_level: "basic",
        account_status: "active",
        created_at: catalogCreatedAt,
        updated_at: catalogCreatedAt,
        deleted_at: null,
        site_admin: siteAdmin,
        school_admin_count: 0,
      },
    ]),
  );
  siteGrants = [
    [operatorGrantID, operatorID],
    [peerGrantID, peerAdminID],
  ].map(([id, userID]) => ({
    id,
    user_id: userID,
    user_name: users.get(userID).name,
    role: "site_admin",
    grant_reason: "Launch operator",
    granted_at: catalogCreatedAt,
  }));
  catalogAudit = new Map();
  catalogSequence = 0;
  logoObjects = new Map();
  revokedSessions.clear();
}
resetCatalog();

const report = {
  id: reportID,
  reporter_user_id: reporterID,
  target_type: "user",
  target_id: targetID,
  reporter_name: "Player One",
  target_name: "Reported Player",
  reason: "<img src=x onerror=\"document.body.dataset.xss='report'\">",
  status: "open",
  resolution_note: "",
  retention_started_at: null,
  created_at: createdAt,
  updated_at: "2026-09-18T16:05:00Z",
};

const ticket = {
  id: ticketID,
  submitter_user_id: reporterID,
  contact_email: "player@example.test",
  name: "Player One",
  subject: '<script>document.body.dataset.xss="ticket"</script>',
  message:
    "<svg onload=\"document.body.dataset.xss='message'\"></svg> Help me recover my account.",
  status: "open",
  resolution_note: "",
  retention_started_at: null,
  created_at: "2026-09-18T16:10:00Z",
  updated_at: "2026-09-18T16:15:00Z",
};

const reportAudit = [];
const ticketAudit = [];
let sequence = 0;
let forcedConflict = false;

// Restores the seeded queue items so no test depends on an earlier one.
const seededQueue = structuredClone({ report, ticket });
function resetQueues() {
  for (const [item, seed] of [
    [report, seededQueue.report],
    [ticket, seededQueue.ticket],
  ]) {
    for (const key of Object.keys(item)) delete item[key];
    Object.assign(item, structuredClone(seed));
  }
  reportAudit.length = 0;
  ticketAudit.length = 0;
  sequence = 0;
  forcedConflict = false;
}

const server = http.createServer(async (request, response) => {
  response.setHeader("content-type", "application/json");
  const requestURL = new URL(
    request.url ?? "/",
    `http://${request.headers.host ?? "127.0.0.1"}`,
  );

  if (requestURL.pathname === "/health") {
    respond(response, 200, { service: "fake-admin-api", status: "ok" });
    return;
  }
  if (request.method === "POST" && requestURL.pathname === "/__test/reset") {
    resetCatalog();
    resetQueues();
    respond(response, 200, { reset: true });
    return;
  }
  if (request.method === "GET" && requestURL.pathname.startsWith("/assets/")) {
    const object = logoObjects.get(
      requestURL.pathname.slice("/assets/".length),
    );
    if (!object) {
      respond(response, 404, { error: "not_found" });
      return;
    }
    response.writeHead(200, {
      "content-type": object.type,
      "x-content-type-options": "nosniff",
    });
    response.end(object.bytes);
    return;
  }
  if (
    request.headers["x-cgn-admin-proxy-secret"] !==
    "browser-test-admin-proxy-secret-00000000"
  ) {
    respond(response, 403, { error: "admin_proxy_required" });
    return;
  }
  const sessionValue = cookieValue(request, "cgn_admin_session");
  if (!sessionValue || revokedSessions.has(sessionValue)) {
    respond(response, 401, { error: "admin_session_required" });
    return;
  }

  if (request.method === "GET" && requestURL.pathname === "/admin/v1/session") {
    respond(response, 200, {
      ...session,
      ...(isSteppedUp(sessionValue)
        ? { step_up_at: new Date().toISOString() }
        : {}),
    });
    return;
  }
  if (
    requestURL.pathname.startsWith("/admin/v1/") &&
    isCatalogPath(requestURL)
  ) {
    await handleCatalog(request, response, requestURL, sessionValue);
    return;
  }
  if (
    request.method === "GET" &&
    (requestURL.pathname === "/admin/v1/report-counts" ||
      requestURL.pathname === "/admin/v1/support-ticket-counts")
  ) {
    const item =
      requestURL.pathname === "/admin/v1/report-counts" ? report : ticket;
    respond(response, 200, {
      open: item.status === "open" ? 1 : 0,
      in_review: item.status === "in_review" ? 1 : 0,
      unassigned: item.status === "open" && !item.assigned_to_user_id ? 1 : 0,
    });
    return;
  }
  if (request.method === "GET" && requestURL.pathname === "/admin/v1/reports") {
    respond(response, 200, {
      reports: matchesFilters(report, requestURL)
        ? [
            {
              id: report.id,
              reporter_user_id: report.reporter_user_id,
              target_type: report.target_type,
              target_id: report.target_id,
              reporter_name: report.reporter_name,
              target_name: report.target_name,
              status: report.status,
              ...(report.assigned_to_user_id
                ? { assigned_to_user_id: report.assigned_to_user_id }
                : {}),
              retention_started_at: report.retention_started_at,
              created_at: report.created_at,
              updated_at: report.updated_at,
            },
          ]
        : [],
      next_cursor: "",
      previous_cursor: "",
    });
    return;
  }
  if (
    request.method === "GET" &&
    requestURL.pathname === `/admin/v1/reports/${reportID}`
  ) {
    respond(response, 200, report);
    return;
  }
  if (
    request.method === "GET" &&
    requestURL.pathname === `/admin/v1/reports/${reportID}/audit`
  ) {
    respond(response, 200, {
      audit_entries: reportAudit,
      next_cursor: "",
      previous_cursor: "",
    });
    return;
  }
  if (
    request.method === "PATCH" &&
    requestURL.pathname === `/admin/v1/reports/${reportID}`
  ) {
    await patchQueueItem(request, response, report, reportAudit, "report");
    return;
  }

  if (
    request.method === "GET" &&
    requestURL.pathname === "/admin/v1/support-tickets"
  ) {
    respond(response, 200, {
      support_tickets: matchesFilters(ticket, requestURL)
        ? [
            {
              id: ticket.id,
              submitter_user_id: ticket.submitter_user_id,
              subject: ticket.subject,
              status: ticket.status,
              ...(ticket.assigned_to_user_id
                ? { assigned_to_user_id: ticket.assigned_to_user_id }
                : {}),
              retention_started_at: ticket.retention_started_at,
              created_at: ticket.created_at,
              updated_at: ticket.updated_at,
            },
          ]
        : [],
      next_cursor: "",
      previous_cursor: "",
    });
    return;
  }
  if (
    request.method === "GET" &&
    requestURL.pathname === `/admin/v1/support-tickets/${ticketID}`
  ) {
    respond(response, 200, ticket);
    return;
  }
  if (
    request.method === "GET" &&
    requestURL.pathname === `/admin/v1/support-tickets/${ticketID}/audit`
  ) {
    respond(response, 200, {
      audit_entries: ticketAudit,
      next_cursor: "",
      previous_cursor: "",
    });
    return;
  }
  if (
    request.method === "PATCH" &&
    requestURL.pathname === `/admin/v1/support-tickets/${ticketID}`
  ) {
    await patchQueueItem(
      request,
      response,
      ticket,
      ticketAudit,
      "support_ticket",
    );
    return;
  }

  respond(response, 404, { error: "not_found" });
});

server.listen(port, "127.0.0.1");

function isCatalogPath(requestURL) {
  return /^\/admin\/v1\/(schools|games|users|site-admin-grants|igdb-games|game-imports)(\/|$)/.test(
    requestURL.pathname,
  );
}

async function handleCatalog(request, response, requestURL, sessionValue) {
  const parts = requestURL.pathname.split("/").slice(3);
  const [collection, id, action, grantID, grantAction] = parts;
  if (request.method === "GET") {
    respondCatalogRead(response, requestURL, collection, id, action);
    return;
  }
  if (!validCSRF(request)) {
    respond(response, 403, { error: "admin_csrf_invalid" });
    return;
  }
  if (
    collection === "schools" &&
    action === "logo" &&
    request.method === "POST"
  ) {
    await uploadLogo(request, response, id);
    return;
  }
  const body = JSON.parse((await readBody(request)) || "{}");
  const recentAuth =
    (collection === "users" &&
      (action === "suspend" || action === "reactivate")) ||
    collection === "site-admin-grants";
  if (recentAuth && !isSteppedUp(sessionValue)) {
    respond(response, 403, { error: "recent_auth_required" });
    return;
  }
  if (!body.reason) {
    respond(response, 400, { error: "invalid_request" });
    return;
  }

  if (collection === "schools" && !id) {
    const school = {
      ...schoolFields(body),
      id: nextID(),
      logo_url: "",
      is_active: true,
      created_at: nextTimestamp(),
      deleted_at: null,
    };
    school.updated_at = school.created_at;
    schools.set(school.id, school);
    recordAudit(school.id, "school.created", {}, school, body.reason);
    respond(response, 201, school);
    return;
  }
  if (collection === "schools" && action === "admin-grants") {
    if (grantID && grantAction === "revoke") {
      const grant = schoolGrants.find((item) => item.id === grantID);
      if (!grant || grant.updated_at !== body.expected_updated_at) {
        respond(response, 409, { error: "admin_record_conflict" });
        return;
      }
      grant.revoked_at = grant.updated_at = nextTimestamp();
      recordAudit(
        grant.id,
        "school_admin.revoked",
        { revoked: false },
        { revoked: true },
        body.reason,
      );
      respond(response, 200, grant);
      return;
    }
    const existing = schoolGrants.find(
      (grant) => grant.school_id === id && grant.user_id === body.user_id,
    );
    if (!schools.has(id) || !users.has(body.user_id)) {
      respond(response, 422, { error: "grant_user_not_eligible" });
      return;
    }
    if (existing) {
      if (existing.updated_at !== body.expected_updated_at) {
        respond(response, 409, { error: "admin_record_conflict" });
        return;
      }
      existing.revoked_at = null;
      existing.updated_at = nextTimestamp();
      recordAudit(
        existing.id,
        "school_admin.granted",
        { revoked: true },
        { revoked: false },
        body.reason,
      );
      respond(response, 201, existing);
      return;
    }
    const grant = {
      id: nextID(),
      school_id: id,
      user_id: body.user_id,
      user_name: users.get(body.user_id).name,
      created_at: nextTimestamp(),
      revoked_at: null,
    };
    grant.updated_at = grant.created_at;
    schoolGrants.push(grant);
    recordAudit(
      grant.id,
      "school_admin.granted",
      {},
      { revoked: false },
      body.reason,
    );
    respond(response, 201, grant);
    return;
  }
  if (collection === "schools" && action === "logo") {
    const school = schools.get(id);
    if (!school || school.updated_at !== body.expected_updated_at) {
      respond(response, 409, { error: "admin_record_conflict" });
      return;
    }
    if (!school.logo_url) {
      respond(response, 409, { error: "invalid_admin_transition" });
      return;
    }
    const before = { logo_url: school.logo_url };
    school.logo_url = "";
    school.updated_at = nextTimestamp();
    recordAudit(
      id,
      "school.logo_removed",
      before,
      { logo_url: "" },
      body.reason,
    );
    respond(response, 200, school);
    return;
  }
  if (collection === "schools") {
    const school = schools.get(id);
    if (!school || school.updated_at !== body.expected_updated_at) {
      respond(response, 409, {
        error: "admin_record_conflict",
        current: school,
      });
      return;
    }
    if (request.method === "DELETE" && schoolsWithHistory.has(id)) {
      respond(response, 409, { error: "catalog_dependencies_exist" });
      return;
    }
    const before = { ...school };
    if (request.method === "PATCH") Object.assign(school, schoolFields(body));
    if (action === "deactivate") school.is_active = false;
    if (action === "reactivate") school.is_active = true;
    if (request.method === "DELETE") school.deleted_at = nextTimestamp();
    school.updated_at = nextTimestamp();
    recordAudit(
      id,
      request.method === "PATCH"
        ? "school.updated"
        : request.method === "DELETE"
          ? "school.deleted"
          : `school.${action}d`,
      before,
      school,
      body.reason,
    );
    respond(response, 200, school);
    return;
  }

  if (collection === "game-imports") {
    const match = igdbGames.find((game) => game.igdb_id === body.igdb_id);
    if (!match) {
      respond(response, 404, { error: "igdb_game_not_found" });
      return;
    }
    const existing = [...games.values()].find(
      (game) => game.igdb_id === body.igdb_id,
    );
    if (existing) {
      respond(response, 409, {
        error: "game_already_imported",
        current: existing,
      });
      return;
    }
    const imported = {
      id: nextID(),
      name: match.name,
      slug: match.name.toLowerCase().replaceAll(" ", "-"),
      is_active: false,
      created_at: nextTimestamp(),
      deleted_at: null,
      igdb_id: match.igdb_id,
      has_cover: true,
    };
    imported.updated_at = imported.created_at;
    imported.last_synced_at = imported.created_at;
    games.set(imported.id, imported);
    recordAudit(imported.id, "game.imported", {}, imported, body.reason);
    respond(response, 201, imported);
    return;
  }

  if (collection === "games") {
    const game = id ? games.get(id) : undefined;
    if (id && (!game || game.updated_at !== body.expected_updated_at)) {
      respond(response, 409, { error: "admin_record_conflict", current: game });
      return;
    }
    if (action === "refresh") {
      const before = { ...game };
      game.updated_at = nextTimestamp();
      game.last_synced_at = game.updated_at;
      recordAudit(id, "game.refreshed", before, game, body.reason);
      respond(response, 200, game);
      return;
    }
    if (!id) {
      if ([...games.values()].some((item) => item.slug === body.slug)) {
        respond(response, 409, { error: "admin_record_already_exists" });
        return;
      }
      const created = {
        id: nextID(),
        name: body.name,
        slug: body.slug,
        ...(body.cover_url ? { cover_url: body.cover_url } : {}),
        is_active: body.is_active,
        created_at: nextTimestamp(),
        deleted_at: null,
        igdb_id: null,
        last_synced_at: null,
        has_cover: false,
      };
      created.updated_at = created.created_at;
      games.set(created.id, created);
      recordAudit(created.id, "game.created", {}, created, body.reason);
      respond(response, 201, created);
      return;
    }
    const before = { ...game };
    if (request.method === "DELETE") {
      game.deleted_at = nextTimestamp();
    } else {
      game.name = body.name;
      game.slug = body.slug;
      game.is_active = body.is_active;
    }
    game.updated_at = nextTimestamp();
    recordAudit(
      id,
      request.method === "DELETE" ? "game.deleted" : "game.updated",
      before,
      game,
      body.reason,
    );
    respond(response, 200, game);
    return;
  }

  if (collection === "users") {
    const user = users.get(id);
    if (!user || user.updated_at !== body.expected_updated_at) {
      respond(response, 409, { error: "admin_record_conflict", current: user });
      return;
    }
    const before = { ...user };
    if (action === "suspend") user.account_status = "suspended";
    if (action === "reactivate") user.account_status = "active";
    if (action === "trust-grants") {
      user.verification_level = body.staff_faculty ? "staff_faculty" : "basic";
    }
    user.updated_at = nextTimestamp();
    recordAudit(
      id,
      action === "trust-grants"
        ? "user.trust_changed"
        : `user.${action === "suspend" ? "suspended" : "reactivated"}`,
      before,
      user,
      body.reason,
    );
    respond(response, 200, user);
    return;
  }

  if (collection === "site-admin-grants" && !id) {
    const user = users.get(body.user_id);
    if (!user || user.updated_at !== body.expected_updated_at) {
      respond(response, 409, { error: "admin_record_conflict" });
      return;
    }
    const grant = {
      id: nextID(),
      user_id: user.id,
      user_name: user.name,
      role: "site_admin",
      grant_reason: body.reason,
      granted_at: nextTimestamp(),
    };
    siteGrants.unshift(grant);
    user.site_admin = true;
    user.updated_at = grant.granted_at;
    recordAudit(
      grant.id,
      "site_role_grant.granted",
      {},
      { active: true },
      body.reason,
    );
    respond(response, 201, grant);
    return;
  }
  if (collection === "site-admin-grants" && action === "revoke") {
    const grant = siteGrants.find((item) => item.id === id && !item.revoked_at);
    if (!grant || grant.granted_at !== body.expected_updated_at) {
      respond(response, 409, { error: "admin_record_conflict" });
      return;
    }
    if (siteGrants.filter((item) => !item.revoked_at).length === 1) {
      respond(response, 409, { error: "last_site_admin" });
      return;
    }
    grant.revoked_at = nextTimestamp();
    grant.revoke_reason = body.reason;
    users.get(grant.user_id).site_admin = false;
    if (grant.user_id === operatorID) revokedSessions.add(sessionValue);
    recordAudit(
      grant.id,
      "site_role_grant.revoked",
      { active: true },
      { active: false },
      body.reason,
    );
    respond(response, 200, grant);
    return;
  }
  respond(response, 404, { error: "not_found" });
}

function respondCatalogRead(response, requestURL, collection, id, action) {
  const page = (key, items) =>
    respond(response, 200, {
      [key]: items,
      next_cursor: "",
      previous_cursor: "",
    });
  if (action === "audit") {
    page(
      "audit_entries",
      catalogAudit.get(requestURL.pathname.split("/").at(-2)) ?? [],
    );
    return;
  }
  const query = (requestURL.searchParams.get("q") ?? "").toLowerCase();
  if (collection === "igdb-games") {
    if (query === "outage") {
      respond(response, 502, { error: "igdb_unavailable" });
      return;
    }
    respond(response, 200, {
      games: igdbGames
        .filter((game) => game.name.toLowerCase().startsWith(query))
        .map((game) => {
          const imported = [...games.values()].find(
            (item) => item.igdb_id === game.igdb_id,
          );
          return Object.assign(
            {},
            game,
            imported ? { game_id: imported.id } : {},
          );
        }),
    });
    return;
  }
  if (collection === "games" && action === "cover") {
    respond(response, 200, { content_type: "image/png", data: coverPNG });
    return;
  }
  const state = requestURL.searchParams.get("state") ?? "";
  const matches = (record, text) =>
    (!query || text.some((value) => value.toLowerCase().startsWith(query))) &&
    (!state || recordState(record) === state);
  if (collection === "schools" && action === "admin-grants") {
    page(
      "grants",
      schoolGrants.filter((grant) => grant.school_id === id),
    );
    return;
  }
  const lookup = {
    schools: [schools, "schools", (school) => [school.name, school.slug]],
    games: [games, "games", (game) => [game.name, game.slug]],
    users: [users, "users", (user) => [user.email, user.name]],
  }[collection];
  if (collection === "site-admin-grants") {
    page(
      "grants",
      siteGrants.filter(
        (grant) =>
          !state || (state === "revoked") === Boolean(grant.revoked_at),
      ),
    );
    return;
  }
  if (!lookup) {
    respond(response, 404, { error: "not_found" });
    return;
  }
  const [records, key, text] = lookup;
  if (id) {
    const record = records.get(id);
    if (record) respond(response, 200, record);
    else respond(response, 404, { error: "admin_record_not_found" });
    return;
  }
  page(
    key,
    [...records.values()].filter((record) => matches(record, text(record))),
  );
}

function recordState(record) {
  if ("account_status" in record) return record.account_status;
  return record.deleted_at
    ? "deleted"
    : record.is_active
      ? "active"
      : "inactive";
}

function schoolFields(body) {
  return {
    unitid: body.unitid,
    name: body.name,
    alias: body.alias,
    slug: body.slug,
    city: body.city,
    state: body.state,
    zip: body.zip,
    website_url: body.website_url,
    latitude: body.latitude,
    longitude: body.longitude,
    is_main_campus: body.is_main_campus,
    num_branches: body.num_branches,
  };
}

function recordAudit(entityID, action, before, after, reason) {
  const entries = catalogAudit.get(entityID) ?? [];
  entries.unshift({
    id: nextID(),
    actor_user_id: operatorID,
    admin_session_id: sessionID,
    action,
    entity_type: action.split(".")[0],
    entity_id: entityID,
    before,
    after,
    metadata: { operator_reason: reason },
    created_at: nextTimestamp(),
  });
  catalogAudit.set(entityID, entries);
}

// Mirrors the Go API's byte-level decision: the file's name and declared type
// are ignored, and anything but a PNG or JPEG signature is rejected.
async function uploadLogo(request, response, id) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const form = await new Request("http://fake.test/", {
    method: "POST",
    headers: { "content-type": request.headers["content-type"] ?? "" },
    body: Buffer.concat(chunks),
  }).formData();
  const school = schools.get(id);
  const file = form.get("file");
  if (!form.get("reason") || !(file instanceof Blob)) {
    respond(response, 400, { error: "invalid_request" });
    return;
  }
  if (!school || school.updated_at !== form.get("expected_updated_at")) {
    respond(response, 409, { error: "admin_record_conflict" });
    return;
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.length > 5 * 1024 * 1024) {
    respond(response, 413, { error: "logo_too_large" });
    return;
  }
  const png = bytes
    .subarray(0, 8)
    .equals(Buffer.from("89504e470d0a1a0a", "hex"));
  const jpeg = bytes.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex"));
  if (!png && !jpeg) {
    respond(response, 415, { error: "logo_unsupported_type" });
    return;
  }
  catalogSequence += 1;
  const key = `school-logos/${id}/${String(catalogSequence).padStart(32, "0")}.${png ? "png" : "jpg"}`;
  logoObjects.set(key, { bytes, type: png ? "image/png" : "image/jpeg" });
  const before = { logo_url: school.logo_url };
  school.logo_url = `${assetBase}/${key}`;
  school.updated_at = nextTimestamp();
  recordAudit(
    id,
    "school.logo_updated",
    before,
    { logo_url: school.logo_url },
    form.get("reason"),
  );
  respond(response, 200, school);
}

function nextID() {
  catalogSequence += 1;
  return `eeeeeeee-eeee-4eee-8eee-${String(catalogSequence).padStart(12, "0")}`;
}

function nextTimestamp() {
  catalogSequence += 1;
  return new Date(Date.parse("2026-09-20T13:00:00Z") + catalogSequence * 1000)
    .toISOString()
    .replace(".000Z", "Z");
}

function validCSRF(request) {
  return (
    request.headers.origin === "http://127.0.0.1:3202" &&
    request.headers["x-cgn-admin-csrf"] === "csrf-token" &&
    cookieValue(request, "cgn_admin_csrf") === "csrf-token"
  );
}

function cookieValue(request, name) {
  const match = String(request.headers.cookie ?? "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return match?.slice(name.length + 1) ?? "";
}

function matchesFilters(item, requestURL) {
  const status = requestURL.searchParams.get("status");
  const assignee = requestURL.searchParams.get("assignee");
  return (
    (!status || item.status === status) &&
    (!assignee ||
      (assignee === "unassigned"
        ? !item.assigned_to_user_id
        : item.assigned_to_user_id === assignee))
  );
}

async function patchQueueItem(request, response, item, audit, entityType) {
  const cookies = String(request.headers.cookie ?? "");
  if (
    request.headers.origin !== "http://127.0.0.1:3202" ||
    request.headers["x-cgn-admin-csrf"] !== "csrf-token" ||
    !cookies.includes("cgn_admin_csrf=csrf-token")
  ) {
    respond(response, 403, { error: "admin_csrf_invalid" });
    return;
  }
  const body = JSON.parse(await readBody(request));
  if (
    entityType === "report" &&
    body.resolution_note === "Force conflict once" &&
    !forcedConflict
  ) {
    forcedConflict = true;
    item.status = "in_review";
    item.updated_at = "2026-09-18T16:20:00Z";
    respond(response, 409, { error: "queue_item_conflict" });
    return;
  }
  if (body.expected_updated_at !== item.updated_at) {
    respond(response, 409, { error: "queue_item_conflict" });
    return;
  }

  const before = queueState(item);
  item.status = body.status;
  if (body.assigned_to_user_id) {
    item.assigned_to_user_id = body.assigned_to_user_id;
    item.assigned_to_name = users.get(body.assigned_to_user_id)?.name;
  } else {
    delete item.assigned_to_user_id;
    delete item.assigned_to_name;
  }
  const noteChanged = item.resolution_note !== body.resolution_note;
  item.resolution_note = body.resolution_note;
  item.retention_started_at =
    body.status === "resolved" || body.status === "closed"
      ? (item.retention_started_at ?? "2026-09-18T16:25:00Z")
      : null;
  sequence += 1;
  item.updated_at = `2026-09-18T16:${String(25 + sequence).padStart(2, "0")}:00Z`;
  audit.unshift({
    id: `77777777-7777-4777-8777-${String(sequence).padStart(12, "0")}`,
    actor_user_id: operatorID,
    admin_session_id: sessionID,
    request_id: `browser-test-${sequence}`,
    action:
      entityType === "report" ? "report.updated" : "support_ticket.updated",
    entity_type: entityType,
    entity_id: item.id,
    before,
    after: queueState(item),
    metadata: { resolution_note_changed: noteChanged },
    created_at: item.updated_at,
  });
  respond(response, 200, item);
}

function queueState(item) {
  return {
    status: item.status,
    assigned_to_user_id: item.assigned_to_user_id ?? null,
    retention_started_at: item.retention_started_at,
  };
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function respond(response, status, payload) {
  response.writeHead(status);
  response.end(JSON.stringify(payload));
}
