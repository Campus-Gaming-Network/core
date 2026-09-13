import { createServer } from "node:http";

const port = Number.parseInt(process.env.PORT ?? "18081", 10);
const password = "E2EPassword123!";
const eventPassword = "E2EEventPassword123!";

const sessions = new Map();
const unlockTokens = new Map();
const rsvps = new Map();
const createdEvents = new Map();
const createdTeams = new Map();
const teamRoles = new Map();
const followedSchools = new Set();
const promotedCaptains = new Set();
const transferredOwners = new Set();
const consumedVerificationTokens = new Set();
const calls = [];

const school = {
  id: "school-e2e",
  unitid: 12345,
  name: "Browser Test University",
  alias: "BTU",
  slug: "browser-test-university",
  city: "Irvine",
  state: "CA",
  zip: "92617",
  website_url: "https://browser.example.test/gaming",
  latitude: 33.64,
  longitude: -117.84,
  is_main_campus: true,
  num_branches: 0
};

const followableSchool = {
  ...school,
  id: "school-follow-e2e",
  unitid: 54321,
  name: "Follow Browser University",
  alias: "FBU",
  slug: "follow-browser-university",
  city: "Long Beach"
};

const game = {
  id: "game-e2e",
  name: "Strategy Arena",
  slug: "strategy-arena"
};

const server = createServer(async (request, response) => {
  try {
    await handleRequest(request, response);
  } catch (error) {
    console.error("Fake API request failed", error);
    json(response, 500, { error: "fake_api_failure" });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Start browser-test API listening on http://127.0.0.1:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}

async function handleRequest(request, response) {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", "http://fake-api.local");

  if (method === "GET" && url.pathname === "/health") {
    json(response, 200, { service: "fake-api", status: "ok" });
    return;
  }

  if (method === "POST" && url.pathname === "/__test/reset") {
    sessions.clear();
    unlockTokens.clear();
    rsvps.clear();
    createdEvents.clear();
    createdTeams.clear();
    teamRoles.clear();
    followedSchools.clear();
    promotedCaptains.clear();
    transferredOwners.clear();
    consumedVerificationTokens.clear();
    calls.length = 0;
    json(response, 200, { reset: true });
    return;
  }

  if (method === "GET" && url.pathname === "/__test/state") {
    json(response, 200, {
      loginCalls: countCalls("POST", "/auth/login"),
      unlockCalls: calls.filter(
        (call) => call.method === "POST" && call.pathname.endsWith("/unlock")
      ).length,
      rsvpCalls: calls.filter(
        (call) => call.method === "POST" && call.pathname.endsWith("/rsvp")
      ).length,
      logoutCalls: countCalls("POST", "/auth/logout"),
      logoutReceivedSession: calls.some(
        (call) =>
          call.method === "POST" &&
          call.pathname === "/auth/logout" &&
          call.hadValidSession
      )
    });
    return;
  }

  if (method === "GET" && url.pathname === "/__test/upstream-calls") {
    json(response, 200, {
      calls: calls.map(({ method: callMethod, pathname }) => ({
        method: callMethod,
        pathname
      }))
    });
    return;
  }

  const body = await readJSONBody(request);
  const sessionToken = cookieValue(request.headers.cookie, "cgn_session");
  const session = sessionToken ? sessions.get(sessionToken) : undefined;
  const call = {
    method,
    pathname: url.pathname,
    hadValidSession: Boolean(session),
    hadUnlockToken: Boolean(request.headers["x-cgn-event-unlock"])
  };
  calls.push(call);

  if (method === "GET" && url.pathname === "/games") {
    json(response, 200, { games: [game] });
    return;
  }

  if (method === "GET" && url.pathname === "/schools") {
    const limit = Number.parseInt(url.searchParams.get("limit") ?? "25", 10);
    const offset = Number.parseInt(url.searchParams.get("offset") ?? "0", 10);
    json(response, 200, {
      schools: [school].slice(offset, offset + limit),
      limit,
      offset,
      has_more: false
    });
    return;
  }

  if (
    method === "GET" &&
    url.pathname === `/schools/${followableSchool.slug}`
  ) {
    json(response, 200, followableSchool);
    return;
  }

  const schoolFollowMatch = url.pathname.match(/^\/schools\/([^/]+)\/follow$/);
  if (schoolFollowMatch && (method === "POST" || method === "DELETE")) {
    if (!session || !sessionToken) {
      json(response, 401, { error: "authentication_required" });
      return;
    }
    const schoolID = decodeURIComponent(schoolFollowMatch[1]);
    if (schoolID !== followableSchool.id) {
      json(response, 404, { error: "school_not_found" });
      return;
    }
    const key = `${sessionToken}:${schoolID}`;
    if (method === "POST") followedSchools.add(key);
    else followedSchools.delete(key);
    response.writeHead(204);
    response.end();
    return;
  }

  if (method === "POST" && url.pathname === "/support-tickets") {
    if (
      typeof body?.contact_email !== "string" ||
      typeof body?.subject !== "string" ||
      typeof body?.message !== "string"
    ) {
      json(response, 400, { error: "invalid_request" });
      return;
    }
    json(response, 201, { id: "support-ticket-e2e" });
    return;
  }

  const userReportMatch = url.pathname.match(/^\/users\/([^/]+)\/report$/);
  if (method === "POST" && userReportMatch) {
    if (!session) {
      json(response, 401, { error: "authentication_required" });
      return;
    }
    if (typeof body?.reason !== "string") {
      json(response, 400, { error: "invalid_request" });
      return;
    }
    json(response, 201, { id: "user-report-e2e" });
    return;
  }

  const userDetailMatch = url.pathname.match(/^\/users\/([^/]+)$/);
  if (method === "GET" && userDetailMatch) {
    const userID = decodeURIComponent(userDetailMatch[1]);
    if (userID === "missing-browser-player") {
      json(response, 404, { error: "user_not_found" });
      return;
    }
    json(response, 200, publicProfileFor(userID));
    return;
  }

  if (method === "POST" && url.pathname === "/auth/signup") {
    if (
      typeof body?.email !== "string" ||
      typeof body?.name !== "string" ||
      body?.home_school_id !== school.id ||
      body?.age_confirmed !== true
    ) {
      json(response, 400, { error: "invalid_request" });
      return;
    }
    json(response, 201, {
      ...profileFor(body.email),
      name: body.name,
      email_verified_at: undefined
    });
    return;
  }

  if (method === "POST" && url.pathname === "/auth/forgot-password") {
    json(response, 202, { status: "if_account_exists_email_sent" });
    return;
  }

  if (method === "POST" && url.pathname === "/auth/resend-verification") {
    json(response, 202, { status: "if_account_exists_email_sent" });
    return;
  }

  if (method === "POST" && url.pathname === "/auth/reset-password") {
    if (typeof body?.token !== "string" || !body.token.startsWith("valid-reset-")) {
      json(response, 400, { error: "invalid_or_expired_token" });
      return;
    }
    response.writeHead(204);
    response.end();
    return;
  }

  if (method === "POST" && url.pathname === "/auth/verify-email") {
    if (
      typeof body?.token !== "string" ||
      !body.token.startsWith("valid-verification-") ||
      consumedVerificationTokens.has(body.token)
    ) {
      json(response, 400, { error: "invalid_or_expired_token" });
      return;
    }
    consumedVerificationTokens.add(body.token);
    json(response, 200, { status: "verified" });
    return;
  }

  if (method === "POST" && url.pathname === "/auth/login") {
    if (
      typeof body?.email !== "string" ||
      !body.email.endsWith("@example.test") ||
      body.password !== password
    ) {
      json(response, 401, { error: "invalid_credentials" });
      return;
    }

    const token = `session-${Buffer.from(body.email).toString("base64url")}`;
    const profile = profileFor(body.email);
    sessions.set(token, profile);
    json(response, 200, profile, {
      "set-cookie":
        `cgn_session=${token}; Path=/; Max-Age=3600; HttpOnly; Secure; SameSite=Lax`
    });
    return;
  }

  if (method === "GET" && url.pathname === "/me") {
    if (!session) {
      json(response, 401, { error: "authentication_required" });
      return;
    }
    json(response, 200, session);
    return;
  }

  if (method === "PATCH" && url.pathname === "/me") {
    if (!session || !sessionToken) {
      json(response, 401, { error: "authentication_required" });
      return;
    }
    const updated = {
      ...session,
      name: body?.name,
      bio: body?.bio,
      timezone: body?.timezone,
      social_links: body?.social_links
    };
    sessions.set(sessionToken, updated);
    json(response, 200, updated);
    return;
  }

  if (method === "DELETE" && url.pathname === "/me") {
    if (!session || !sessionToken) {
      json(response, 401, { error: "authentication_required" });
      return;
    }
    sessions.delete(sessionToken);
    response.writeHead(204);
    response.end();
    return;
  }

  if (method === "GET" && url.pathname === "/me/events") {
    if (!session) {
      json(response, 401, { error: "authentication_required" });
      return;
    }
    json(response, 200, {
      upcoming_rsvps: [dashboardEvent("Browser Dashboard RSVP", "yes")],
      followed_school_events: [dashboardEvent("Browser Followed Event")]
    });
    return;
  }

  if (method === "GET" && url.pathname === "/me/schools") {
    json(
      response,
      session ? 200 : 401,
      session
        ? {
            schools: followedSchools.has(
              `${sessionToken}:${followableSchool.id}`
            )
              ? [followableSchool]
              : []
          }
        : { error: "authentication_required" }
    );
    return;
  }

  if (method === "GET" && url.pathname === "/me/teams") {
    json(
      response,
      session ? 200 : 401,
      session
        ? { teams: [teamFor("browser-team", sessionToken)], limit: 10 }
        : { error: "authentication_required" }
    );
    return;
  }

  if (method === "POST" && url.pathname === "/auth/logout") {
    if (sessionToken) {
      sessions.delete(sessionToken);
    }
    response.writeHead(204, {
      "set-cookie":
        "cgn_session=; Path=/; Max-Age=-1; HttpOnly; Secure; SameSite=Lax"
    });
    response.end();
    return;
  }

  if (method === "GET" && url.pathname === "/events") {
    json(response, 200, {
      events: [...createdEvents.values()]
        .filter((record) => !record.cancelled)
        .map((record) => eventBrowseItem(record.event)),
      limit: 25,
      has_more: false,
      has_previous: false
    });
    return;
  }

  if (method === "POST" && url.pathname === "/events") {
    if (!session || !sessionToken) {
      json(response, 401, { error: "authentication_required" });
      return;
    }
    const slug = `${slugify(body?.title ?? "browser-event")}-${sessionToken.slice(-8)}`;
    const event = createdEventFromBody(body, slug, session);
    createdEvents.set(slug, {
      event,
      ownerSession: sessionToken,
      interestedSessions: new Set(),
      cancelled: false
    });
    json(response, 201, createdEventFor(slug, sessionToken));
    return;
  }

  const eventInterestMatch = url.pathname.match(/^\/events\/([^/]+)\/interest$/);
  if (
    eventInterestMatch &&
    (method === "POST" || method === "DELETE")
  ) {
    if (!session || !sessionToken) {
      json(response, 401, { error: "authentication_required" });
      return;
    }
    const slug = decodeURIComponent(eventInterestMatch[1]);
    const record = createdEvents.get(slug);
    if (!record) {
      json(response, 404, { error: "event_not_found" });
      return;
    }
    if (method === "POST") record.interestedSessions.add(sessionToken);
    else record.interestedSessions.delete(sessionToken);
    json(response, 200, createdEventFor(slug, sessionToken));
    return;
  }

  const eventReportMatch = url.pathname.match(/^\/events\/([^/]+)\/report$/);
  if (method === "POST" && eventReportMatch) {
    if (!session || typeof body?.reason !== "string") {
      json(response, 401, { error: "authentication_required" });
      return;
    }
    if (body.reason === "Trigger report failure") {
      json(response, 503, { error: "reporting_unavailable" });
      return;
    }
    json(response, 201, { id: "report-e2e" });
    return;
  }

  const eventMatch = url.pathname.match(/^\/events\/([^/]+)$/);
  if (
    eventMatch &&
    (method === "GET" || method === "PATCH" || method === "DELETE")
  ) {
    const slug = decodeURIComponent(eventMatch[1]);
    if (slug === "missing-browser-event") {
      json(response, 404, { error: "event_not_found" });
      return;
    }
    const created = createdEvents.get(slug);
    if (created) {
      if (method === "PATCH") {
        if (!sessionToken || created.ownerSession !== sessionToken) {
          json(response, 403, { error: "event_organizer_required" });
          return;
        }
        created.event = {
          ...created.event,
          ...body,
          slug,
          host_school: school,
          games: [game]
        };
      } else if (method === "DELETE") {
        if (!sessionToken || created.ownerSession !== sessionToken) {
          json(response, 403, { error: "event_organizer_required" });
          return;
        }
        created.cancelled = true;
        response.writeHead(204);
        response.end();
        return;
      }
      json(response, 200, createdEventFor(slug, sessionToken));
      return;
    }
    if (method !== "GET") {
      json(response, 404, { error: "event_not_found" });
      return;
    }
    if (slug === "public-browser-event" || slug === "long-content-event") {
      json(response, 200, publicEventFor(slug));
      return;
    }
    const suppliedUnlock = singleHeader(request.headers["x-cgn-event-unlock"]);
    const expectedUnlock = unlockTokens.get(slug);
    if (!expectedUnlock || suppliedUnlock !== expectedUnlock) {
      json(response, 200, { slug, visibility: "private", locked: true });
      return;
    }
    json(response, 200, eventFor(slug, rsvpFor(sessionToken, slug)));
    return;
  }

  const unlockMatch = url.pathname.match(/^\/events\/([^/]+)\/unlock$/);
  if (method === "POST" && unlockMatch) {
    const slug = decodeURIComponent(unlockMatch[1]);
    if (body?.password !== eventPassword) {
      json(response, 422, { error: "invalid_private_password" });
      return;
    }
    const token = `unlock-${Buffer.from(slug).toString("base64url")}`;
    unlockTokens.set(slug, token);
    json(response, 200, {
      event: eventFor(slug),
      unlock_token: token,
      expires_at: "2037-08-15T20:00:00Z"
    });
    return;
  }

  const rsvpMatch = url.pathname.match(/^\/events\/([^/]+)\/rsvp$/);
  if (method === "POST" && rsvpMatch) {
    const slug = decodeURIComponent(rsvpMatch[1]);
    const suppliedUnlock = singleHeader(request.headers["x-cgn-event-unlock"]);
    const expectedUnlock = unlockTokens.get(slug);
    if (!session || !sessionToken) {
      json(response, 401, { error: "authentication_required" });
      return;
    }
    if (!expectedUnlock || suppliedUnlock !== expectedUnlock) {
      json(response, 403, { error: "private_event_locked" });
      return;
    }
    if (!body || !["yes", "maybe", "no"].includes(body.response)) {
      json(response, 422, { error: "invalid_request" });
      return;
    }
    rsvps.set(rsvpKey(sessionToken, slug), body.response);
    json(response, 200, eventFor(slug, body.response));
    return;
  }

  if (method === "GET" && url.pathname === "/teams") {
    const slugs = new Set(["joinable-browser-team", ...createdTeams.keys()]);
    json(response, 200, {
      teams: [...slugs].map((slug) => publicTeam(teamFor(slug, sessionToken))),
      limit: 25,
      has_more: false,
      has_previous: false
    });
    return;
  }

  if (method === "POST" && url.pathname === "/teams") {
    if (!session || !sessionToken) {
      json(response, 401, { error: "authentication_required" });
      return;
    }
    const slug = `${slugify(body?.name ?? "browser-team")}-${sessionToken.slice(-8)}`;
    createdTeams.set(slug, {
      name: body?.name,
      description: body?.description,
      school: body?.school_id ? school : undefined,
      games: [game]
    });
    teamRoles.set(teamRoleKey(sessionToken, slug), "owner");
    json(response, 201, { slug });
    return;
  }

  const teamDetailMatch = url.pathname.match(/^\/teams\/([^/]+)$/);
  if (method === "GET" && teamDetailMatch) {
    const slug = decodeURIComponent(teamDetailMatch[1]);
    if (slug === "missing-browser-team") {
      json(response, 404, { error: "team_not_found" });
      return;
    }
    json(response, 200, teamFor(slug, sessionToken));
    return;
  }

  const teamJoinMatch = url.pathname.match(/^\/teams\/([^/]+)\/join$/);
  if (method === "POST" && teamJoinMatch) {
    if (!session || !sessionToken) {
      json(response, 401, { error: "authentication_required" });
      return;
    }
    const slug = decodeURIComponent(teamJoinMatch[1]);
    if (body?.password !== "BrowserTeamPass123!") {
      json(response, 401, { error: "invalid_team_password" });
      return;
    }
    teamRoles.set(teamRoleKey(sessionToken, slug), "member");
    json(response, 200, { slug });
    return;
  }

  const captainMatch = url.pathname.match(/^\/teams\/([^/]+)\/captains$/);
  if (method === "POST" && captainMatch) {
    const slug = decodeURIComponent(captainMatch[1]);
    if (teamRoles.get(teamRoleKey(sessionToken, slug)) !== "owner") {
      json(response, 403, { error: "not_team_owner" });
      return;
    }
    const captainKey = `${sessionToken}:${slug}:${String(body?.user_id)}`;
    if (body?.captain === true) promotedCaptains.add(captainKey);
    else promotedCaptains.delete(captainKey);
    json(response, 200, { slug });
    return;
  }

  const transferMatch = url.pathname.match(
    /^\/teams\/([^/]+)\/transfer-ownership$/
  );
  if (method === "POST" && transferMatch) {
    const slug = decodeURIComponent(transferMatch[1]);
    if (teamRoles.get(teamRoleKey(sessionToken, slug)) !== "owner") {
      json(response, 403, { error: "not_team_owner" });
      return;
    }
    transferredOwners.add(`${sessionToken}:${slug}`);
    teamRoles.set(teamRoleKey(sessionToken, slug), "member");
    json(response, 200, { slug });
    return;
  }

  json(response, 404, { error: "not_found" });
}

function eventFor(slug, viewerRsvp) {
  return {
    id: `event-${slug}`,
    title: "Invitation-Only Strategy Session",
    slug,
    description: "Private plans shared only after the event is unlocked.",
    visibility: "private",
    format: "in_person",
    starts_at: "2037-08-15T17:00:00Z",
    ends_at: "2037-08-15T19:00:00Z",
    timezone: "America/Los_Angeles",
    location_name: "Private Student Union Room",
    address: "123 Hidden Campus Way",
    capacity: 24,
    rsvp_yes_count: viewerRsvp === "yes" ? 1 : 0,
    interest_count: 2,
    lifecycle: "upcoming",
    is_paid: false,
    host_school: {
      id: "school-e2e",
      name: "Browser Test University",
      slug: "browser-test-university",
      city: "Irvine",
      state: "CA"
    },
    games: [{ id: "game-e2e", name: "Strategy Arena", slug: "strategy-arena" }],
    organizers: [
      {
        id: "user-e2e",
        name: "Browser Test Player",
        role: "creator",
        verification_level: "verified_student"
      }
    ],
    ...(viewerRsvp ? { viewer_rsvp: viewerRsvp } : {})
  };
}

function publicEventFor(slug) {
  return {
    ...eventFor(slug),
    title: slug === "long-content-event"
      ? "ExtremelyLongUnbrokenUserSuppliedTournamentTitleThatMustWrapWithoutCreatingHorizontalViewportOverflowAtNarrowWidths"
      : "Public Browser Tournament",
    description: "A public campus tournament used for browser parity checks.",
    visibility: "public",
    location_name: "Browser Student Union",
    address: "100 Public Campus Way"
  };
}

function createdEventFromBody(body, slug, profile) {
  return {
    id: `event-${slug}`,
    title: body.title,
    slug,
    description: body.description,
    visibility: body.visibility,
    format: body.format,
    starts_at: body.starts_at,
    ends_at: body.ends_at,
    timezone: body.timezone,
    ...(body.location_name ? { location_name: body.location_name } : {}),
    ...(body.address ? { address: body.address } : {}),
    ...(body.online_url ? { online_url: body.online_url } : {}),
    ...(body.capacity ? { capacity: body.capacity } : {}),
    rsvp_yes_count: 0,
    interest_count: 0,
    lifecycle: "upcoming",
    ...(body.recurrence_rule ? { recurrence_rule: body.recurrence_rule } : {}),
    ...(body.recurrence_until
      ? { recurrence_until: `${body.recurrence_until}T23:59:59Z` }
      : {}),
    is_paid: body.is_paid,
    ...(body.payment_note ? { payment_note: body.payment_note } : {}),
    ...(body.payment_url ? { payment_url: body.payment_url } : {}),
    host_school: school,
    games: [game],
    organizers: [
      {
        id: profile.id,
        name: profile.name,
        role: "creator",
        verification_level: profile.verification_level
      }
    ]
  };
}

function createdEventFor(slug, sessionToken) {
  const record = createdEvents.get(slug);
  return {
    ...record.event,
    interest_count: record.interestedSessions.size,
    viewer_interested: record.interestedSessions.has(sessionToken),
    viewer_can_edit: record.ownerSession === sessionToken
  };
}

function eventBrowseItem(event) {
  return {
    id: event.id,
    title: event.title,
    slug: event.slug,
    format: event.format,
    starts_at: event.starts_at,
    ends_at: event.ends_at,
    timezone: event.timezone,
    ...(event.location_name ? { location_name: event.location_name } : {}),
    ...(event.address ? { address: event.address } : {}),
    ...(event.online_url ? { online_url: event.online_url } : {}),
    lifecycle: event.lifecycle,
    host_school: { name: event.host_school.name },
    games: event.games.map(({ name }) => ({ name }))
  };
}

function teamFor(slug, sessionToken) {
  const created = createdTeams.get(slug);
  const viewerRole = teamRoles.get(teamRoleKey(sessionToken, slug));
  const candidateID = "user-browser-teammate";
  const candidateRole = promotedCaptains.has(
    `${sessionToken}:${slug}:${candidateID}`
  )
    ? "captain"
    : "member";
  const name = created?.name ?? "Joinable Browser Team";
  return {
    id: `team-${slug}`,
    name,
    slug,
    description:
      created?.description ?? "A browser-test team open to campus players.",
    member_count: 2,
    ...(created?.school === undefined && !created
      ? { school }
      : created?.school
        ? { school: created.school }
        : {}),
    games: created?.games ?? [game],
    ...(viewerRole ? { viewer_role: viewerRole } : {}),
    ...(viewerRole === "owner"
      ? {
          members: [
            {
              user_id: sessions.get(sessionToken)?.id ?? "user-browser-owner",
              name: sessions.get(sessionToken)?.name ?? "Browser Owner",
              role: "owner"
            },
            {
              user_id: candidateID,
              name: "Browser Teammate",
              role: candidateRole
            }
          ]
        }
      : {}),
    ownership_transferred: transferredOwners.has(`${sessionToken}:${slug}`)
  };
}

function publicTeam(team) {
  const {
    viewer_role: _viewerRole,
    members: _members,
    ownership_transferred: _ownershipTransferred,
    ...publicFields
  } = team;
  return publicFields;
}

function teamRoleKey(sessionToken, slug) {
  return `${sessionToken ?? ""}:${slug}`;
}

function dashboardEvent(title, viewerRsvp) {
  return {
    id: `event-${slugify(title)}`,
    title,
    slug: slugify(title),
    starts_at: "2037-08-18T17:00:00Z",
    ends_at: "2037-08-18T19:00:00Z",
    timezone: "America/Los_Angeles",
    lifecycle: "upcoming",
    host_school: { name: school.name },
    games: [{ name: game.name }],
    ...(viewerRsvp ? { viewer_rsvp: viewerRsvp } : {})
  };
}

function slugify(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "") || "browser-item";
}

function profileFor(email) {
  return {
    id: `user-${Buffer.from(email).toString("base64url")}`,
    email,
    email_verified_at: "2037-08-01T12:00:00Z",
    verification_level: "verified_student",
    name: email.startsWith("owner-") ? "Browser Team Owner" : "Browser Test Player",
    bio: "Browser-test campus player",
    timezone: "America/Los_Angeles",
    home_school_id: school.id,
    home_school: school,
    social_links: [],
    role_indicators: []
  };
}

function publicProfileFor(id) {
  return {
    id,
    name: "Reportable Browser Player",
    bio: "A public browser-test profile.",
    verification_level: "verified_student",
    home_school_id: school.id,
    home_school: school,
    social_links: [],
    role_indicators: []
  };
}

function rsvpFor(sessionToken, slug) {
  return sessionToken ? rsvps.get(rsvpKey(sessionToken, slug)) : undefined;
}

function rsvpKey(sessionToken, slug) {
  return `${sessionToken}:${slug}`;
}

function countCalls(method, pathname) {
  return calls.filter(
    (call) => call.method === method && call.pathname === pathname
  ).length;
}

function cookieValue(header, name) {
  for (const part of (header ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator >= 0 && part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim() || undefined;
    }
  }
  return undefined;
}

function singleHeader(value) {
  return Array.isArray(value) ? value[0] : value;
}

async function readJSONBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 64 * 1024) {
      throw new Error("Request body exceeded 64 KiB");
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) {
    return undefined;
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text.trim() ? JSON.parse(text) : undefined;
}

function json(response, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    ...headers
  });
  response.end(body);
}
