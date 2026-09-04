import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

const host = "127.0.0.1";
const port = Number.parseInt(process.env.PORT ?? "18080", 10);
const eventSlug = "private-scrim-abc123";
const managedTeamSlug = "long-beach-legends-abc123";
const transferCandidateID = "user-transfer-e2e";
const unlockToken = "e2e-private-event-unlock";
const sessions = new Map();
const rsvps = new Set();
const createdEvents = new Map();
const teamRoles = new Map();
const promotedCaptainSessions = new Set();
const transferredOwnerSessions = new Set();

const homeSchool = {
  id: "school-uci",
  name: "University of California, Irvine",
  slug: "university-of-california-irvine",
  city: "Irvine",
  state: "CA"
};

const followedSchool = {
  id: "school-csulb",
  name: "California State University, Long Beach",
  slug: "california-state-university-long-beach",
  city: "Long Beach",
  state: "CA",
  is_main_campus: true,
  num_branches: 0
};

const game = {
  id: "game-valorant",
  name: "Valorant",
  slug: "valorant"
};

const profile = {
  id: "user-e2e",
  email: "player@example.test",
  email_verified_at: "2036-12-01T00:00:00Z",
  verification_level: "verified",
  name: "E2E Player",
  timezone: "America/Los_Angeles",
  home_school_id: homeSchool.id,
  home_school: homeSchool,
  social_links: []
};

const ownerProfile = {
  ...profile,
  id: "user-owner-e2e",
  email: "owner@example.test",
  name: "Team Owner"
};

const catalogHomeSchool = {
  ...homeSchool,
  is_main_campus: true,
  num_branches: 0
};

const followedEvent = {
  id: "event-followed",
  title: "Campus Open Play",
  slug: "campus-open-play-efgh5678",
  description: "Open games for the whole campus.",
  visibility: "public",
  format: "in_person",
  starts_at: "2037-02-20T02:00:00Z",
  ends_at: "2037-02-20T05:00:00Z",
  timezone: "America/Los_Angeles",
  location_name: "Student Union",
  rsvp_yes_count: 4,
  interest_count: 7,
  lifecycle: "upcoming",
  is_paid: false,
  host_school: followedSchool,
  games: [game]
};

const upcomingRSVP = {
  ...followedEvent,
  id: "event-rsvp",
  title: "Rocket League Finals",
  slug: "rocket-league-finals-abcd1234",
  viewer_rsvp: "yes"
};

const team = {
  id: "team-e2e",
  name: "UCI Valorant",
  slug: "uci-valorant-abcd1234",
  description: "UCI competitive Valorant roster.",
  owner_user_id: "user-owner",
  member_count: 5,
  school: homeSchool,
  games: [game],
  viewer_role: "member"
};

function managedTeam(sessionToken) {
  const viewerRole = teamRoles.get(sessionToken);
  const candidateRole = promotedCaptainSessions.has(sessionToken)
    ? "captain"
    : "member";

  return {
    id: "team-managed-e2e",
    name: "Long Beach Legends",
    slug: managedTeamSlug,
    description: "A public team used to exercise membership management.",
    owner_user_id: transferredOwnerSessions.has(sessionToken)
      ? transferCandidateID
      : ownerProfile.id,
    member_count: 2,
    school: followedSchool,
    games: [game],
    viewer_role: viewerRole,
    members:
      viewerRole === "owner"
        ? [
            {
              user_id: ownerProfile.id,
              name: ownerProfile.name,
              role: "owner"
            },
            {
              user_id: transferCandidateID,
              name: "Transfer Candidate",
              role: candidateRole
            }
          ]
        : undefined
  };
}

function createdEvent(record, sessionToken) {
  return {
    ...record.event,
    interest_count: record.interestedSessions.size,
    viewer_interested: record.interestedSessions.has(sessionToken),
    viewer_can_edit: record.ownerSession === sessionToken
  };
}

function privateEvent(sessionToken) {
  return {
    id: "event-private",
    title: "Midnight Strategy Session",
    slug: eventSlug,
    description: "Private practice details for invited players.",
    visibility: "private",
    format: "online",
    starts_at: "2037-02-15T04:00:00Z",
    ends_at: "2037-02-15T06:00:00Z",
    timezone: "America/Los_Angeles",
    online_url: "https://example.test/private-room",
    capacity: 10,
    rsvp_yes_count: rsvps.size,
    interest_count: 0,
    lifecycle: "upcoming",
    is_paid: false,
    host_school: homeSchool,
    games: [game],
    organizers: [
      {
        id: "user-organizer",
        name: "Event Organizer",
        role: "creator",
        role_indicators: ["school_admin"]
      }
    ],
    viewer_rsvp:
      sessionToken && rsvps.has(sessionToken) ? "yes" : undefined,
    viewer_interested: false,
    viewer_can_edit: false
  };
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${host}:${port}`);
    const sessionToken = sessionFrom(request);
    const authenticated = sessionToken !== "" && sessions.has(sessionToken);
    const sessionProfile = sessions.get(sessionToken);
    const unlocked =
      request.headers["x-cgn-event-unlock"] === unlockToken;

    if (request.method === "GET" && url.pathname === "/health") {
      json(response, 200, { service: "cgn-e2e-api", status: "ok" });
      return;
    }

    if (request.method === "GET" && url.pathname === "/schools") {
      json(response, 200, {
        schools: [catalogHomeSchool, followedSchool],
        limit: Number.parseInt(url.searchParams.get("limit") ?? "25", 10),
        offset: 0
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/games") {
      json(response, 200, { games: [game] });
      return;
    }

    if (request.method === "POST" && url.pathname === "/auth/signup") {
      const body = await readJSON(request);
      if (
        body.name !== "New Campus Player" ||
        body.email !== "new-player@example.test" ||
        body.password !== "NewPassword123!" ||
        body.home_school_id !== followedSchool.id ||
        body.age_confirmed !== true ||
        body.timezone !== "America/Los_Angeles"
      ) {
        json(response, 400, { error: "invalid_request" });
        return;
      }

      json(response, 201, {
        ...profile,
        id: "user-signup-e2e",
        email: body.email,
        email_verified_at: undefined,
        name: body.name,
        home_school_id: body.home_school_id,
        home_school: followedSchool
      });
      return;
    }

    if (
      request.method === "POST" &&
      url.pathname === "/auth/resend-verification"
    ) {
      const body = await readJSON(request);
      if (body.email !== "new-player@example.test") {
        json(response, 400, { error: "invalid_request" });
        return;
      }
      json(response, 202, { status: "if_account_exists_email_sent" });
      return;
    }

    if (request.method === "POST" && url.pathname === "/auth/login") {
      const body = await readJSON(request);
      const loginProfile =
        body.email === profile.email
          ? profile
          : body.email === ownerProfile.email
            ? ownerProfile
            : undefined;
      if (!loginProfile || body.password !== "Password12345!") {
        json(response, 401, { error: "invalid_credentials" });
        return;
      }

      const token = `e2e-${randomUUID()}`;
      sessions.set(token, loginProfile);
      if (loginProfile.id === ownerProfile.id) {
        teamRoles.set(token, "owner");
      }
      json(response, 200, loginProfile, {
        "set-cookie": `cgn_session=${token}; Path=/; Max-Age=3600; HttpOnly; SameSite=Lax`
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/me") {
      json(
        response,
        authenticated ? 200 : 401,
        authenticated ? sessionProfile : { error: "authentication_required" }
      );
      return;
    }

    if (request.method === "POST" && url.pathname === "/events") {
      if (!authenticated) {
        json(response, 401, { error: "authentication_required" });
        return;
      }
      const body = await readJSON(request);
      if (
        body.title !== "Campus Fall Brawl" ||
        body.description !== "An evening tournament for campus players." ||
        body.host_school_id !== homeSchool.id ||
        body.visibility !== "public" ||
        body.format !== "in_person" ||
        body.starts_at !== "2037-03-10T02:00:00Z" ||
        body.ends_at !== "2037-03-10T05:00:00Z" ||
        body.timezone !== "America/Los_Angeles" ||
        body.location_name !== "Student Union Arena" ||
        body.capacity !== 24 ||
        body.is_paid !== false ||
        !Array.isArray(body.game_ids) ||
        body.game_ids.length !== 1 ||
        body.game_ids[0] !== game.id
      ) {
        json(response, 400, { error: "invalid_request" });
        return;
      }

      const slug = `campus-fall-brawl-${sessionToken.slice(-8)}`;
      const record = {
        ownerSession: sessionToken,
        interestedSessions: new Set(),
        cancelled: false,
        event: {
          id: `event-${sessionToken.slice(-8)}`,
          title: body.title,
          slug,
          description: body.description,
          visibility: body.visibility,
          format: body.format,
          starts_at: body.starts_at,
          ends_at: body.ends_at,
          timezone: body.timezone,
          location_name: body.location_name,
          capacity: body.capacity,
          rsvp_yes_count: 0,
          interest_count: 0,
          lifecycle: "upcoming",
          is_paid: false,
          host_school: homeSchool,
          games: [game],
          organizers: [
            {
              id: sessionProfile.id,
              name: sessionProfile.name,
              role: "creator"
            }
          ]
        }
      };
      createdEvents.set(slug, record);
      json(response, 201, createdEvent(record, sessionToken));
      return;
    }

    if (request.method === "GET" && url.pathname === "/events") {
      const events = Array.from(createdEvents.values())
        .filter((record) => !record.cancelled)
        .map((record) => createdEvent(record, sessionToken));
      json(response, 200, { events, limit: 25, offset: 0 });
      return;
    }

    const interestMatch = url.pathname.match(/^\/events\/([^/]+)\/interest$/);
    if (
      interestMatch &&
      (request.method === "POST" || request.method === "DELETE")
    ) {
      if (!authenticated) {
        json(response, 401, { error: "authentication_required" });
        return;
      }
      const slug = decodeURIComponent(interestMatch[1]);
      const record = createdEvents.get(slug);
      if (!record) {
        json(response, 404, { error: "event_not_found" });
        return;
      }
      if (request.method === "POST") {
        record.interestedSessions.add(sessionToken);
      } else {
        record.interestedSessions.delete(sessionToken);
      }
      json(response, 200, createdEvent(record, sessionToken));
      return;
    }

    const createdEventMatch = url.pathname.match(/^\/events\/([^/]+)$/);
    if (
      createdEventMatch &&
      (request.method === "GET" || request.method === "DELETE")
    ) {
      const slug = decodeURIComponent(createdEventMatch[1]);
      const record = createdEvents.get(slug);
      if (record) {
        if (request.method === "DELETE") {
          if (!authenticated || record.ownerSession !== sessionToken) {
            json(response, 403, { error: "event_organizer_required" });
            return;
          }
          record.cancelled = true;
          empty(response, 204);
          return;
        }
        json(response, 200, createdEvent(record, sessionToken));
        return;
      }
    }

    if (
      request.method === "POST" &&
      url.pathname === `/events/${eventSlug}/unlock`
    ) {
      const body = await readJSON(request);
      if (body.password !== "EventPass123!") {
        json(response, 401, { error: "invalid_private_password" });
        return;
      }
      json(response, 200, {
        event: privateEvent(sessionToken),
        unlock_token: unlockToken,
        expires_at: "2037-02-15T06:00:00Z"
      });
      return;
    }

    if (
      request.method === "POST" &&
      url.pathname === `/events/${eventSlug}/rsvp`
    ) {
      const body = await readJSON(request);
      if (!authenticated) {
        json(response, 401, { error: "authentication_required" });
        return;
      }
      if (!unlocked) {
        json(response, 403, { error: "private_event_locked" });
        return;
      }
      if (body.response !== "yes") {
        json(response, 400, { error: "invalid_request" });
        return;
      }

      rsvps.add(sessionToken);
      json(response, 200, privateEvent(sessionToken));
      return;
    }

    if (
      request.method === "GET" &&
      url.pathname === `/events/${eventSlug}`
    ) {
      json(
        response,
        200,
        unlocked
          ? privateEvent(sessionToken)
          : { slug: eventSlug, visibility: "private", locked: true }
      );
      return;
    }

    if (request.method === "GET" && url.pathname === "/teams") {
      json(response, 200, {
        teams: [managedTeam(sessionToken)],
        limit: 25,
        offset: 0
      });
      return;
    }

    if (
      request.method === "GET" &&
      url.pathname === `/teams/${managedTeamSlug}`
    ) {
      json(response, 200, managedTeam(sessionToken));
      return;
    }

    if (
      request.method === "POST" &&
      url.pathname === `/teams/${managedTeamSlug}/join`
    ) {
      if (!authenticated) {
        json(response, 401, { error: "authentication_required" });
        return;
      }
      const body = await readJSON(request);
      if (body.password !== "TeamPass123!") {
        json(response, 401, { error: "invalid_team_password" });
        return;
      }
      teamRoles.set(sessionToken, "member");
      json(response, 200, managedTeam(sessionToken));
      return;
    }

    if (
      request.method === "POST" &&
      url.pathname === `/teams/${managedTeamSlug}/captains`
    ) {
      if (!authenticated || teamRoles.get(sessionToken) !== "owner") {
        json(response, 403, { error: "not_team_owner" });
        return;
      }
      const body = await readJSON(request);
      if (
        body.user_id !== transferCandidateID ||
        typeof body.captain !== "boolean"
      ) {
        json(response, 400, { error: "invalid_request" });
        return;
      }
      if (body.captain) {
        promotedCaptainSessions.add(sessionToken);
      } else {
        promotedCaptainSessions.delete(sessionToken);
      }
      json(response, 200, managedTeam(sessionToken));
      return;
    }

    if (
      request.method === "POST" &&
      url.pathname === `/teams/${managedTeamSlug}/transfer-ownership`
    ) {
      if (!authenticated || teamRoles.get(sessionToken) !== "owner") {
        json(response, 403, { error: "not_team_owner" });
        return;
      }
      const body = await readJSON(request);
      if (body.new_owner_user_id !== transferCandidateID) {
        json(response, 400, { error: "invalid_request" });
        return;
      }
      transferredOwnerSessions.add(sessionToken);
      teamRoles.set(sessionToken, "member");
      json(response, 200, managedTeam(sessionToken));
      return;
    }

    if (request.method === "GET" && url.pathname === "/me/events") {
      if (!authenticated) {
        json(response, 401, { error: "authentication_required" });
        return;
      }
      json(response, 200, {
        upcoming_rsvps: [upcomingRSVP],
        followed_school_events: [followedEvent]
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/me/schools") {
      json(
        response,
        authenticated ? 200 : 401,
        authenticated
          ? { schools: [followedSchool] }
          : { error: "authentication_required" }
      );
      return;
    }

    if (request.method === "GET" && url.pathname === "/me/teams") {
      json(
        response,
        authenticated ? 200 : 401,
        authenticated
          ? { teams: [team], limit: 10 }
          : { error: "authentication_required" }
      );
      return;
    }

    json(response, 404, { error: "not_found" });
  } catch (error) {
    json(response, 500, {
      error: "e2e_fixture_failed",
      detail: error instanceof Error ? error.message : String(error)
    });
  }
});

server.listen(port, host);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}

function sessionFrom(request) {
  for (const pair of (request.headers.cookie ?? "").split(";")) {
    const [name, ...value] = pair.trim().split("=");
    if (name === "cgn_session") {
      return value.join("=");
    }
  }
  return "";
}

async function readJSON(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text === "" ? {} : JSON.parse(text);
}

function json(response, status, body, headers = {}) {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json",
    ...headers
  });
  response.end(JSON.stringify(body));
}

function empty(response, status) {
  response.writeHead(status, { "cache-control": "no-store" });
  response.end();
}
