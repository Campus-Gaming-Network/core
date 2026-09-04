import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

const host = "127.0.0.1";
const port = Number.parseInt(process.env.PORT ?? "18080", 10);
const eventSlug = "private-scrim-abc123";
const unlockToken = "e2e-private-event-unlock";
const sessions = new Set();
const rsvps = new Set();

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
    const unlocked =
      request.headers["x-cgn-event-unlock"] === unlockToken;

    if (request.method === "GET" && url.pathname === "/health") {
      json(response, 200, { service: "cgn-e2e-api", status: "ok" });
      return;
    }

    if (request.method === "POST" && url.pathname === "/auth/login") {
      const body = await readJSON(request);
      if (
        body.email !== "player@example.test" ||
        body.password !== "Password12345!"
      ) {
        json(response, 401, { error: "invalid_credentials" });
        return;
      }

      const token = `e2e-${randomUUID()}`;
      sessions.add(token);
      json(response, 200, profile, {
        "set-cookie": `cgn_session=${token}; Path=/; Max-Age=3600; HttpOnly; SameSite=Lax`
      });
      return;
    }

    if (request.method === "GET" && url.pathname === "/me") {
      json(
        response,
        authenticated ? 200 : 401,
        authenticated ? profile : { error: "authentication_required" }
      );
      return;
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
          ? { teams: [team], limit: 10, offset: 0 }
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
