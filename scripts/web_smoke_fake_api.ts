import {
  createServer,
  type IncomingMessage,
  type OutgoingHttpHeaders,
  type ServerResponse,
} from "node:http";
import { type Server as NetServer } from "node:net";
import {
  eventPassword,
  eventSlug,
  fakeAPIHealthPayload,
  missingEventSlug,
  missingPublicProfileID,
  missingSchoolSlug,
  missingTeamSlug,
  outageSessionToken,
  privateEventSecrets,
  publicEventSlug,
  publicProfileID,
  schoolSlug,
  sessionToken,
  smokePublicID,
  teamSlug,
  unlockToken,
  type JSONBody,
  type UpstreamCall,
} from "./web_smoke_constants.ts";

export async function startFakeAPI(signal: AbortSignal) {
  const calls: UpstreamCall[] = [];
  const server = createServer(async (request, response) => {
    try {
      await handleFakeAPIRequest(request, response, calls);
    } catch {
      writeJSON(response, 500, { error: "fake_api_failure" });
    }
  });

  const port = await listenOnEphemeralPort(server, signal);
  return { calls, server, origin: `http://127.0.0.1:${port}` };
}

async function handleFakeAPIRequest(
  request: IncomingMessage,
  response: ServerResponse,
  calls: UpstreamCall[],
) {
  const method = request.method ?? "GET";
  const requestURL = new URL(request.url ?? "/", "http://fake-api.local");
  const body = await readJSONRequestBody(request);
  const call: UpstreamCall = {
    method,
    pathname: requestURL.pathname,
    search: requestURL.search,
    cookie: headerValue(request.headers.cookie),
    eventUnlock: headerValue(request.headers["x-cgn-event-unlock"]),
    body,
  };
  calls.push(call);

  if (
    (method === "GET" || method === "HEAD") &&
    requestURL.pathname === "/health"
  ) {
    writeJSON(response, 200, fakeAPIHealthPayload, { head: method === "HEAD" });
    return;
  }

  if (method === "GET" && requestURL.pathname === "/games") {
    writeJSON(response, 200, {
      games: [{ id: "game-smoke", name: "Smoke Arena", slug: "smoke-arena" }],
    });
    return;
  }

  if (method === "GET" && requestURL.pathname === "/games/smoke-arena") {
    writeJSON(response, 200, {
      id: "game-smoke",
      name: "Smoke Arena",
      slug: "smoke-arena",
    });
    return;
  }

  if (method === "GET" && requestURL.pathname === "/events") {
    writeJSON(response, 200, {
      events: [fakePublicEvent()],
      limit: 25,
      has_more: false,
      has_previous: false,
    });
    return;
  }

  if (method === "GET" && requestURL.pathname === "/teams") {
    writeJSON(response, 200, {
      teams: [fakeTeam()],
      limit: 25,
      has_more: false,
      has_previous: false,
    });
    return;
  }

  if (method === "GET" && requestURL.pathname === `/teams/${missingTeamSlug}`) {
    writeJSON(response, 404, { error: "team_not_found" });
    return;
  }

  if (method === "GET" && requestURL.pathname === `/teams/${teamSlug}`) {
    writeJSON(response, 200, fakeTeam());
    return;
  }

  if (method === "GET" && requestURL.pathname === "/schools") {
    const limit = Number.parseInt(
      requestURL.searchParams.get("limit") ?? "25",
      10,
    );
    const offset = Number.parseInt(
      requestURL.searchParams.get("offset") ?? "0",
      10,
    );
    writeJSON(response, 200, {
      schools: [fakeSchool()],
      limit,
      offset,
      has_more: false,
    });
    return;
  }

  if (
    method === "GET" &&
    requestURL.pathname === `/schools/${missingSchoolSlug}`
  ) {
    writeJSON(response, 404, { error: "school_not_found" });
    return;
  }

  if (method === "GET" && requestURL.pathname === `/schools/${schoolSlug}`) {
    writeJSON(response, 200, fakeSchool());
    return;
  }

  if (
    method === "GET" &&
    requestURL.pathname === `/users/${missingPublicProfileID}`
  ) {
    writeJSON(response, 404, { error: "user_not_found" });
    return;
  }

  if (method === "GET" && requestURL.pathname === `/users/${publicProfileID}`) {
    writeJSON(response, 200, fakePublicProfile());
    return;
  }

  if (
    method === "GET" &&
    requestURL.pathname === `/events/${missingEventSlug}`
  ) {
    writeJSON(response, 404, { error: "event_not_found" });
    return;
  }

  if (method === "GET" && requestURL.pathname === `/events/${eventSlug}`) {
    if (call.eventUnlock === unlockToken) {
      writeJSON(
        response,
        200,
        visibleEvent({
          viewerCanEdit: call.cookie?.includes(`cgn_session=${sessionToken}`),
        }),
      );
    } else {
      writeJSON(response, 200, {
        slug: eventSlug,
        visibility: "private",
        locked: true,
      });
    }
    return;
  }

  if (method === "GET" && requestURL.pathname === "/me/events") {
    writeJSON(response, 200, {
      upcoming_rsvps: [fakeAccountEvent("Smoke Dashboard RSVP", "yes")],
      followed_school_events: [fakeAccountEvent("Smoke Followed Event")],
    });
    return;
  }

  if (method === "GET" && requestURL.pathname === "/me/schools") {
    writeJSON(response, 200, { schools: [fakeSchool()] });
    return;
  }

  if (method === "GET" && requestURL.pathname === "/me/teams") {
    writeJSON(response, 200, {
      teams: [
        {
          ...fakeTeam(),
          viewer_role: "member",
          members: [{ name: "private-account-member" }],
        },
      ],
      limit: 10,
    });
    return;
  }

  if (method === "GET" && requestURL.pathname === "/me") {
    if (call.cookie?.includes(`cgn_session=${outageSessionToken}`)) {
      writeJSON(response, 503, { error: "service_unavailable" });
    } else if (call.cookie?.includes(`cgn_session=${sessionToken}`)) {
      writeJSON(response, 200, fakeProfile());
    } else {
      writeJSON(response, 401, { error: "authentication_required" });
    }
    return;
  }

  if (method === "POST" && requestURL.pathname === "/auth/login") {
    if (
      body?.email === "player@example.test" &&
      body?.password === "Password12345!"
    ) {
      writeJSON(response, 200, fakeProfile(), {
        headers: {
          "set-cookie": `cgn_session=${sessionToken}; Path=/; Max-Age=3600; HttpOnly; Secure; SameSite=Lax`,
        },
      });
    } else {
      writeJSON(response, 401, { error: "invalid_credentials" });
    }
    return;
  }

  if (method === "POST" && requestURL.pathname === "/auth/logout") {
    // Deliberately omit Set-Cookie. The Start BFF must still delete its local
    // configured session cookie before reporting logout success.
    response.writeHead(204);
    response.end();
    return;
  }

  if (
    method === "POST" &&
    requestURL.pathname === `/events/${eventSlug}/unlock`
  ) {
    if (body?.password === eventPassword) {
      writeJSON(response, 200, {
        event: visibleEvent(),
        unlock_token: unlockToken,
        expires_at: "2037-08-15T20:00:00Z",
      });
    } else {
      writeJSON(response, 422, { error: "invalid_private_password" });
    }
    return;
  }

  if (
    method === "POST" &&
    requestURL.pathname === `/events/${eventSlug}/rsvp`
  ) {
    if (!call.cookie?.includes(`cgn_session=${sessionToken}`)) {
      writeJSON(response, 401, { error: "authentication_required" });
    } else if (call.eventUnlock !== unlockToken) {
      writeJSON(response, 403, { error: "private_event_locked" });
    } else {
      writeJSON(response, 200, visibleEvent({ viewerRSVP: body?.response }));
    }
    return;
  }

  writeJSON(response, 404, { error: "not_found" });
}

function visibleEvent({
  viewerRSVP,
  viewerCanEdit = false,
}: { viewerRSVP?: unknown; viewerCanEdit?: boolean } = {}) {
  return {
    id: "event-smoke",
    slug: eventSlug,
    title: privateEventSecrets.title,
    description: privateEventSecrets.description,
    visibility: "private",
    format: "in_person",
    starts_at: "2037-08-15T17:00:00Z",
    ends_at: "2037-08-15T19:00:00Z",
    timezone: "America/Los_Angeles",
    location_name: privateEventSecrets.location,
    address: privateEventSecrets.address,
    capacity: 24,
    rsvp_yes_count: viewerRSVP === "yes" ? 1 : 0,
    interest_count: 2,
    lifecycle: "upcoming",
    cost: "unspecified",
    revision: 0,
    updated_at: "2037-08-01T17:00:00Z",
    host_school: {
      id: "school-smoke",
      name: "Smoke Test University",
      slug: "smoke-test-university",
      city: "Irvine",
      state: "CA",
    },
    games: [
      {
        id: "game-smoke",
        name: "Smoke Arena",
        slug: "smoke-arena",
        has_cover: false,
      },
    ],
    organizers: [
      {
        id: "user-smoke",
        public_id: smokePublicID,
        name: "Smoke Player",
        role: "creator",
        verification_level: "verified_student",
      },
    ],
    ...(viewerCanEdit ? { viewer_can_edit: true } : {}),
    ...(viewerRSVP === "yes" || viewerRSVP === "maybe" || viewerRSVP === "no"
      ? { viewer_rsvp: viewerRSVP }
      : {}),
  };
}

function fakePublicEvent() {
  return {
    id: "event-public-smoke",
    title: "Public Smoke Tournament",
    slug: publicEventSlug,
    format: "in_person",
    starts_at: "2037-08-20T17:00:00Z",
    ends_at: "2037-08-20T20:00:00Z",
    timezone: "America/Los_Angeles",
    location_name: "Smoke Student Union",
    address: "100 Public Campus Way",
    lifecycle: "upcoming",
    cost: "unspecified",
    host_school: { name: "Smoke Test University", slug: schoolSlug },
    games: [{ name: "Smoke Arena" }],
    rsvp_yes_count: 3,
    interest_count: 2,
    private_note: "private-event-browse-note",
  };
}

function fakeAccountEvent(title: string, viewerRSVP?: string) {
  return {
    id: `account-${title.toLowerCase().replaceAll(" ", "-")}`,
    title,
    slug: title.toLowerCase().replaceAll(" ", "-"),
    starts_at: "2037-08-18T17:00:00Z",
    ends_at: "2037-08-18T19:00:00Z",
    timezone: "America/Los_Angeles",
    lifecycle: "upcoming",
    host_school: fakeSchool(),
    games: [{ id: "game-smoke", name: "Smoke Arena", slug: "smoke-arena" }],
    rsvp_yes_count: 3,
    interest_count: 2,
    ...(viewerRSVP ? { viewer_rsvp: viewerRSVP } : {}),
    private_note: "account-event-private-note",
  };
}

function fakeTeam() {
  return {
    id: "team-smoke",
    name: "Smoke Arena Team",
    slug: teamSlug,
    description: "A public collegiate team used by the production smoke test.",
    member_count: 7,
    school: {
      id: "school-smoke",
      name: "Smoke Test University",
      slug: schoolSlug,
      city: "Irvine",
      state: "CA",
    },
    games: [{ id: "game-smoke", name: "Smoke Arena", slug: "smoke-arena" }],
    owner_user_id: "private-owner-user-id",
    members: [
      {
        user_id: "private-owner-user-id",
        name: "private-member@example.test",
        role: "member",
      },
    ],
    private_note: "private-team-note",
  };
}

function fakeProfile() {
  return {
    id: "user-smoke",
    public_id: smokePublicID,
    email: "player@example.test",
    email_verified_at: "2037-08-01T12:00:00Z",
    verification_level: "verified_student",
    name: "Smoke Player",
    timezone: "America/Los_Angeles",
    home_school_id: "school-smoke",
    home_school: fakeSchool(),
    social_links: [
      {
        id: "social-smoke",
        label: "Community",
        url: "https://community.example.test/smoke-player",
      },
    ],
    role_indicators: [],
    password_hash: "account-password-hash",
    session: "account-session-secret",
  };
}

function fakeSchool() {
  return {
    id: "school-smoke",
    unitid: 12345,
    name: "Smoke Test University",
    alias: "STU",
    slug: schoolSlug,
    city: "Irvine",
    state: "CA",
    zip: "92617",
    website_url: "https://smoke.example.test/gaming",
    latitude: 33.64,
    longitude: -117.84,
    is_main_campus: true,
    num_branches: 1,
    private_note: "private-school-note",
  };
}

function fakePublicProfile() {
  return {
    id: "public-smoke-user",
    public_id: publicProfileID,
    name: "Public Smoke Player",
    avatar_url: "https://images.example.test/public-smoke-player.png",
    bio: "Public campus competitor",
    verification_level: "verified_student",
    home_school_id: "school-smoke",
    home_school: fakeSchool(),
    social_links: [
      {
        id: "social-smoke",
        label: "Community",
        url: "https://community.example.test/public-smoke-player",
      },
    ],
    role_indicators: ["school_admin"],
    email: "private-profile@example.test",
    session: "private-profile-session",
    internal_header: "private-profile-internal-header",
  };
}

async function readJSONRequestBody(
  request: IncomingMessage,
): Promise<JSONBody | undefined> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 64 * 1024) {
      throw new Error("Fake API request body exceeded 64 KiB");
    }
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return undefined;
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text.trim() ? (JSON.parse(text) as JSONBody) : undefined;
}

function writeJSON(
  response: ServerResponse,
  status: number,
  payload: unknown,
  {
    head = false,
    headers = {},
  }: { head?: boolean; headers?: OutgoingHttpHeaders } = {},
) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    ...headers,
  });
  response.end(head ? undefined : body);
}

function headerValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export function listenOnEphemeralPort(
  server: NetServer,
  signal: AbortSignal,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      server.close();
      reject(signal.reason);
    };
    const onError = (error: Error) => {
      signal.removeEventListener("abort", onAbort);
      reject(error);
    };

    signal.addEventListener("abort", onAbort, { once: true });
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      signal.removeEventListener("abort", onAbort);
      server.removeListener("error", onError);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(
          new Error("Unable to determine dynamically selected localhost port"),
        );
        return;
      }
      resolve(address.port);
    });
  });
}
