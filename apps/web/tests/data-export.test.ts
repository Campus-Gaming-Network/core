import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { dataExportResponse } from "../src/features/account-slice/data-export.server.js";
import { validateSupportSearch } from "../src/features/support-slice/contracts.js";
import { createApiClient, type Fetcher } from "../src/server/api.server.js";
import { bodyText, requestURL } from "./fetch-stub.js";

const origin = "https://cgn.example";
const exported = {
  format_version: 1,
  exported_at: "2026-10-17T12:00:00Z",
  account: { name: "Player", email: "player@example.test" },
  social_links: [],
  followed_schools: [{ name: "Home U", slug: "home-u" }],
  school_admin_roles: [],
  site_roles: [],
  game_lists: [],
  teams: [],
  clubs: [{ name: "Chess Club", slug: "chess-club", role: "owner" }],
  club_claims: [],
  events_organized: [],
  rsvps: [],
  interested_events: [],
  support_tickets: [],
  reports: [],
  notifications: [],
  policy_acceptances: [],
  sessions: [],
  active_days: ["2026-10-16", "2026-10-17"],
};

function exportRequest({
  password = "secret",
  requestOrigin = origin,
}: { password?: string; requestOrigin?: string } = {}): Request {
  const body = new FormData();
  body.set("current_password", password);
  return new Request(`${origin}/api/account/export`, {
    method: "POST",
    body,
    headers: { origin: requestOrigin },
  });
}

async function respond(
  request: Request,
  fetcher: Fetcher,
  cookieHeader = "cgn_session=value",
) {
  const response = await dataExportResponse(request, {
    api: createApiClient({ baseUrl: "http://api:8080", fetcher }),
    cookieHeader,
    publicOrigin: origin,
    reportError: () => {},
  });
  return {
    status: response.status,
    location: response.headers.get("location"),
    disposition: response.headers.get("content-disposition"),
    cache: response.headers.get("cache-control"),
    body: response.status === 200 ? await response.json() : undefined,
  };
}

test("the download sends the password to the API and saves its answer as a dated file", async () => {
  const calls: Array<{ body: unknown; cookie: string | null; url: string }> =
    [];
  const result = await respond(exportRequest(), async (input, init) => {
    calls.push({
      body: JSON.parse(bodyText(init)),
      cookie: new Headers(init?.headers).get("cookie"),
      url: requestURL(input),
    });
    return Response.json({ ...exported, internal_note: "strip" });
  });

  assert.deepEqual(
    { calls, result },
    {
      calls: [
        {
          body: { current_password: "secret" },
          cookie: "cgn_session=value",
          url: "http://api:8080/me/export",
        },
      ],
      result: {
        status: 200,
        location: null,
        disposition:
          'attachment; filename="campus-gaming-network-data-2026-10-17.json"',
        cache: "private, no-store",
        body: exported,
      },
    },
  );
});

test("a refused download returns to the page with a reason, and another site cannot start one", async () => {
  let called = 0;
  const failing = (error: string, status: number): Fetcher => {
    return async () => {
      called++;
      return Response.json({ error }, { status });
    };
  };
  const results = await Promise.all([
    respond(exportRequest(), failing("invalid_current_password", 422)),
    respond(exportRequest(), failing("rate_limited", 429)),
    respond(exportRequest(), failing("authentication_required", 401)),
    respond(exportRequest(), failing("data_export_failed", 500)),
    respond(exportRequest({ password: "" }), failing("unused", 500)),
    respond(exportRequest(), failing("unused", 500), ""),
    respond(
      exportRequest({ requestOrigin: "https://evil.example" }),
      failing("unused", 500),
    ),
  ]);

  assert.deepEqual(
    {
      called,
      outcomes: results.map(({ status, location }) => [status, location]),
    },
    {
      called: 4,
      outcomes: [
        [303, "/settings/data?export=wrong-password"],
        [303, "/settings/data?export=rate-limited"],
        [303, "/login?next=%2Fsettings%2Fdata"],
        [303, "/settings/data?export=failed"],
        [303, "/settings/data?export=wrong-password"],
        [303, "/login?next=%2Fsettings%2Fdata"],
        [403, null],
      ],
    },
  );
});

test("a privacy link starts the support form as a privacy request", () => {
  assert.deepEqual(
    [
      validateSupportSearch({ topic: "privacy", support: "submitted" }),
      validateSupportSearch({ topic: "billing" }),
    ],
    [{ support: "submitted", topic: "privacy" }, {}],
  );
});
