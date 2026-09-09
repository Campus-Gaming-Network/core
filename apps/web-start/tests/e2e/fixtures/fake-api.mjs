import { createServer } from "node:http";

const port = Number.parseInt(process.env.PORT ?? "18081", 10);
const password = "E2EPassword123!";
const eventPassword = "E2EEventPassword123!";

const sessions = new Map();
const unlockTokens = new Map();
const rsvps = new Map();
const calls = [];

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

  const eventMatch = url.pathname.match(/^\/events\/([^/]+)$/);
  if (method === "GET" && eventMatch) {
    const slug = decodeURIComponent(eventMatch[1]);
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

function profileFor(email) {
  return {
    id: `user-${Buffer.from(email).toString("base64url")}`,
    email,
    email_verified_at: "2037-08-01T12:00:00Z",
    verification_level: "verified_student",
    name: "Browser Test Player",
    timezone: "America/Los_Angeles",
    home_school_id: "school-e2e",
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
