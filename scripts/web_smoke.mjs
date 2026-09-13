#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  accessSync,
  constants as fsConstants,
  readdirSync,
  statSync
} from "node:fs";
import { createServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { homedir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const overallTimeoutMilliseconds = 45_000;
const startupTimeoutMilliseconds = 15_000;
const requestTimeoutMilliseconds = 5_000;
const shutdownTimeoutMilliseconds = 3_000;
const maximumChildOutputBytes = 32 * 1024;
const fakeAPIHealthPayload = {
  service: "fake-go-api",
  status: "ok",
  source: "web-production-smoke"
};
const eventSlug = "private-smoke-event";
const missingEventSlug = "missing-smoke-event";
const publicEventSlug = "public-smoke-event";
const schoolSlug = "smoke-test-university";
const missingSchoolSlug = "missing-smoke-school";
const teamSlug = "smoke-arena-team";
const missingTeamSlug = "missing-smoke-team";
const publicProfileID = "public-smoke-user";
const missingPublicProfileID = "missing-smoke-user";
const eventPassword = "SmokeEventPassword123!";
const unlockToken = "smoke-private-event-unlock-token";
const sessionToken = "smoke-session-token";
const outageSessionToken = "smoke-outage-session-token";
const privateEventSecrets = {
  title: "Midnight Strategy Session",
  description: "Private tournament plans for invited players only.",
  location: "Secret Student Union Room",
  address: "123 Private Campus Way"
};

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const webRoot = path.join(repositoryRoot, "apps", "web");
const launcherPath = path.join(
  webRoot,
  "src",
  "production-preflight.ts"
);
const outputEntryPath = path.join(
  webRoot,
  ".output",
  "server",
  "index.mjs"
);

let fakeAPIServer;
let webProcess;
let childOutput;

const overallController = new AbortController();
const overallTimer = setTimeout(() => {
  overallController.abort(
    new Error(
      `Smoke test exceeded ${overallTimeoutMilliseconds}ms overall timeout`
    )
  );
}, overallTimeoutMilliseconds);

try {
  assertReadableFile(
    launcherPath,
    "Production launcher is missing; expected apps/web/src/production-preflight.ts"
  );
  assertReadableFile(
    outputEntryPath,
    "Production output is missing; build apps/web before running this smoke test"
  );

  const nodeBinary = findNode24Binary();
  const fakeAPI = await startFakeAPI(overallController.signal);
  fakeAPIServer = fakeAPI.server;
  const webPort = await findAvailablePort(overallController.signal);
  const webOrigin = `http://127.0.0.1:${webPort}`;

  webProcess = spawn(
    nodeBinary,
    ["src/production-preflight.ts"],
    {
      cwd: webRoot,
      env: {
        ...process.env,
        NODE_ENV: "production",
        DEPLOYMENT_ENV: "local",
        API_INTERNAL_URL: fakeAPI.origin,
        API_SESSION_COOKIE: "cgn_session",
        API_PROXY_SHARED_SECRET: "local-smoke-proxy-secret-not-for-production",
        CLOUDFLARE_ORIGIN_SECRET:
          "local-smoke-cloudflare-secret-not-for-production",
        SITE_URL: webOrigin,
        HOST: "127.0.0.1",
        NITRO_HOST: "127.0.0.1",
        PORT: String(webPort)
      },
      stdio: ["ignore", "pipe", "pipe"]
    }
  );
  childOutput = captureChildOutput(webProcess);

  await waitForWebServer(
    webOrigin,
    webProcess,
    childOutput,
    overallController.signal
  );
  await verifyHomePage(webOrigin, fakeAPI.calls, overallController.signal);
  await verifyAccountRoute(webOrigin, fakeAPI.calls, overallController.signal);
  await verifyPhase4RouteBoundaries(
    webOrigin,
    fakeAPI.calls,
    overallController.signal
  );
  await verifyEventBrowse(webOrigin, fakeAPI.calls, overallController.signal);
  await verifyTeamRoutes(webOrigin, fakeAPI.calls, overallController.signal);
  await verifySchoolRoutes(webOrigin, fakeAPI.calls, overallController.signal);
  await verifyPublicProfileRoutes(
    webOrigin,
    fakeAPI.calls,
    overallController.signal
  );
  await verifySchoolsAPI(webOrigin, overallController.signal);
  await verifyHealthRoute(webOrigin, overallController.signal);
  await verifyHealthMethodBoundary(webOrigin, overallController.signal);
  await verifyNavigationSessionRoute(
    webOrigin,
    fakeAPI.calls,
    overallController.signal
  );
  await verifyNotFoundPage(webOrigin, overallController.signal);
  await verifyEventNotFound(
    webOrigin,
    fakeAPI.calls,
    overallController.signal
  );
  const lockedEventHTML = await verifyLockedEvent(
    webOrigin,
    fakeAPI.calls,
    overallController.signal
  );
  const loginHTML = await getHTML(
    `${webOrigin}/login?next=${encodeURIComponent(`/events/${eventSlug}`)}`,
    overallController.signal,
    "GET /login"
  );
  const loginAction = discoverFormAction(loginHTML, "form-stack", webOrigin);
  await verifyCrossOriginPostRejected(
    webOrigin,
    loginAction,
    fakeAPI.calls,
    overallController.signal
  );
  const sessionCookie = await verifyNativeLogin(
    webOrigin,
    loginAction,
    fakeAPI.calls,
    overallController.signal
  );
  await verifyAuthenticatedViewerOutage(
    webOrigin,
    fakeAPI.calls,
    overallController.signal
  );
  const unlockAction = discoverFormAction(
    lockedEventHTML,
    "private-unlock-form",
    webOrigin
  );
  const unlockCookie = await verifyNativeUnlock(
    webOrigin,
    unlockAction,
    sessionCookie,
    fakeAPI.calls,
    overallController.signal
  );
  const authenticatedCookies = `${sessionCookie}; ${unlockCookie}`;
  await verifyAuthenticatedWritePages(
    webOrigin,
    authenticatedCookies,
    fakeAPI.calls,
    overallController.signal
  );
  const visibleEventHTML = await verifyUnlockedEvent(
    webOrigin,
    authenticatedCookies,
    fakeAPI.calls,
    overallController.signal
  );
  const rsvpAction = discoverFormAction(
    visibleEventHTML,
    "rsvp-form",
    webOrigin
  );
  await verifyNativeRSVP(
    webOrigin,
    rsvpAction,
    authenticatedCookies,
    fakeAPI.calls,
    overallController.signal
  );
  const logoutAction = discoverFormAction(
    visibleEventHTML,
    "logout-form",
    webOrigin
  );
  await verifyNativeLogout(
    webOrigin,
    logoutAction,
    authenticatedCookies,
    fakeAPI.calls,
    overallController.signal
  );
  assertSensitiveValuesAbsentFromLogs(childOutput.format());

  process.stdout.write(
    `PASS TanStack Start production HTTP smoke (${nodeVersion(nodeBinary)})\n`
  );
  process.stdout.write(`  GET /: 200 SSR catalog parity shell and metadata\n`);
  process.stdout.write(`  Account: auth redirect and private composed dashboard SSR\n`);
  process.stdout.write(`  Phase 4 auth/write pages: SSR metadata, private token pages, and anonymous redirects\n`);
  process.stdout.write(`  Event browse: filtered SSR catalog with safe public DTOs\n`);
  process.stdout.write(`  Team browse/detail: dynamic SSR, safe DTOs, and true 404\n`);
  process.stdout.write(`  School browse/detail and public profile: dynamic SSR + true 404s\n`);
  process.stdout.write(`  /api/schools: validation, HEAD/cache contract, and all 405 boundaries\n`);
  process.stdout.write(`  GET /api/health: 200 exact healthy envelope\n`);
  process.stdout.write(`  /api/health: HEAD plus all unsupported-method 405 boundaries\n`);
  process.stdout.write(`  /api/navigation-session: viewer states, HEAD/no-store, and all 405 boundaries\n`);
  process.stdout.write(`  GET unknown route: 404 noindex shell\n`);
  process.stdout.write(`  GET locked/missing events: private 200 shell and true 404\n`);
  process.stdout.write(`  Cross-origin native form POST: rejected before upstream\n`);
  process.stdout.write(`  Native login/unlock/RSVP/logout forms: 303 redirects, cookies, upstream calls\n`);
  process.stdout.write(`  Authenticated write pages: private SSR metadata and no-store boundaries\n`);
  process.stdout.write(`  Authenticated /me outage: safe event error\n`);
} catch (error) {
  const detail = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`FAIL TanStack Start production HTTP smoke\n${detail}\n`);
  if (childOutput) {
    process.stderr.write(childOutput.format());
  }
  process.exitCode = 1;
} finally {
  clearTimeout(overallTimer);
  await terminateChild(webProcess);
  await closeServer(fakeAPIServer);
}

async function verifyHomePage(origin, upstreamCalls, overallSignal) {
  const callsBefore = upstreamCalls.length;
  const response = await smokeFetch(`${origin}/`, {}, overallSignal);
  assert.equal(response.status, 200, "GET / must return HTTP 200");
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
    "GET / must return HTML"
  );
  assert.equal(
    response.headers.get("cache-control"),
    "public, max-age=0, must-revalidate",
    "Anonymous public shell responses must remain revalidatable instead of carrying viewer data"
  );
  assert.match(
    response.headers.get("vary") ?? "",
    /(?:^|,\s*)Cookie(?:,|$)/i,
    "Public shell responses must vary by Cookie"
  );

  const html = await response.text();
  assert.match(
    html,
    /<title>Campus Gaming Network<\/title>/i,
    "GET / SSR output must include the Campus Gaming Network title"
  );
  assertSSRDocumentShell(html, "GET /");
  assert.match(
    html,
    /<h1[^>]*>Find the campus gaming scene around you\.<\/h1>/i,
    "GET / SSR output must include the parity home heading"
  );
  assert.ok(
    html.includes("Smoke Arena") && html.includes("Smoke Test University"),
    "GET / SSR output must include its independently loaded game and school catalogs"
  );
  assert.match(
    html,
    new RegExp(
      `<meta\\s+property="og:url"\\s+content="${escapeRegularExpression(origin)}"\\s*\\/?>`,
      "i"
    ),
    "GET / must emit an absolute Open Graph URL from SITE_URL"
  );

  const calls = upstreamCalls.slice(callsBefore);
  oneUpstreamCall(calls, "GET", "/schools");
  oneUpstreamCall(calls, "GET", "/games");
}

async function verifyAccountRoute(origin, upstreamCalls, overallSignal) {
  const anonymous = await smokeFetch(
    `${origin}/account`,
    { redirect: "manual" },
    overallSignal
  );
  assert.equal(
    anonymous.status,
    307,
    "Anonymous account requests must retain the temporary redirect status"
  );
  const anonymousLocation = new URL(
    anonymous.headers.get("location") ?? "",
    origin
  );
  assert.equal(anonymousLocation.pathname, "/login");
  assert.equal(
    anonymousLocation.searchParams.get("next"),
    "/account",
    "Anonymous account redirects must retain the exact local return path"
  );
  await anonymous.body?.cancel();

  const callsBefore = upstreamCalls.length;
  const response = await smokeFetch(
    `${origin}/account`,
    { headers: { cookie: `cgn_session=${sessionToken}` } },
    overallSignal
  );
  assert.equal(response.status, 200, "Authenticated GET /account must return 200");
  assert.equal(
    response.headers.get("cache-control"),
    "private, no-store",
    "Account responses must never be shared or cached"
  );
  const html = await response.text();
  assertSSRDocumentShell(html, "Account dashboard");
  assert.match(
    html,
    /<title>Account \| Campus Gaming Network<\/title>/i,
    "Account must render its private noindex metadata"
  );
  assert.match(
    html,
    /<meta\s+name="robots"\s+content="noindex,nofollow"\s*\/?>/i,
    "Account must remain noindex"
  );
  for (const expected of [
    "Smoke Player",
    "Smoke Dashboard RSVP",
    "Smoke Followed Event",
    "Smoke Arena Team",
    "Smoke Test University"
  ]) {
    assert.ok(html.includes(expected), `Account SSR must include ${expected}`);
  }
  for (const privateValue of [
    "account-password-hash",
    "account-session-secret",
    "private-account-member"
  ]) {
    assert.ok(
      !html.includes(privateValue),
      `Account loader DTO must strip ${privateValue}`
    );
  }

  const calls = upstreamCalls.slice(callsBefore);
  assert.equal(
    matchingUpstreamCalls(calls, "GET", "/me").length,
    1,
    "Authenticated account SSR must perform only its account profile read"
  );
  oneUpstreamCall(calls, "GET", "/me/events");
  oneUpstreamCall(calls, "GET", "/me/schools");
  oneUpstreamCall(calls, "GET", "/me/teams");
}

async function verifyPhase4RouteBoundaries(
  origin,
  upstreamCalls,
  overallSignal
) {
  const publicPages = [
    {
      path: "/signup?q=Smoke",
      title: "Sign up",
      heading: "Join with your home school."
    },
    {
      path: "/forgot-password",
      title: "Forgot password",
      heading: "Get a reset link."
    },
    {
      path: "/reset-password?token=smoke-reset-token",
      title: "Reset password",
      heading: "Choose a new password.",
      private: true
    },
    {
      path: "/auth/verify-email?token=smoke-verification-token",
      title: "Verify email",
      heading: "Confirm your email.",
      private: true
    }
  ];

  for (const page of publicPages) {
    const response = await smokeFetch(`${origin}${page.path}`, {}, overallSignal);
    assert.equal(response.status, 200, `GET ${page.path} must return 200`);
    if (page.private) {
      assert.equal(
        response.headers.get("cache-control"),
        "private, no-store",
        `GET ${page.path} must not cache recovery tokens`
      );
    }
    const html = await response.text();
    assertSSRDocumentShell(html, `GET ${page.path}`);
    assert.match(
      html,
      new RegExp(`<title>${escapeRegularExpression(page.title)} \\| Campus Gaming Network<\\/title>`, "i"),
      `GET ${page.path} must render route metadata`
    );
    assert.ok(
      html.includes(page.heading),
      `GET ${page.path} must render its primary heading`
    );
  }

  const legacyReset = await smokeFetch(
    `${origin}/auth/reset-password?token=legacy-smoke-token`,
    { redirect: "manual" },
    overallSignal
  );
  assert.equal(legacyReset.status, 307, "Legacy reset route must retain a temporary redirect");
  assert.equal(
    new URL(legacyReset.headers.get("location") ?? "", origin).href,
    `${origin}/reset-password?token=legacy-smoke-token`,
    "Legacy reset route must preserve the validated token"
  );
  await legacyReset.body?.cancel();

  const encodedLegacyReset = await smokeFetch(
    `${origin}/auth/reset-password?token=${encodeURIComponent("encoded/token+value=")}`,
    { redirect: "manual" },
    overallSignal
  );
  assert.equal(encodedLegacyReset.status, 307);
  const encodedDestination = new URL(
    encodedLegacyReset.headers.get("location") ?? "",
    origin
  );
  assert.equal(encodedDestination.pathname, "/reset-password");
  assert.equal(encodedDestination.searchParams.get("token"), "encoded/token+value=");
  await encodedLegacyReset.body?.cancel();

  const missingLegacyReset = await smokeFetch(
    `${origin}/auth/reset-password`,
    { redirect: "manual" },
    overallSignal
  );
  assert.equal(missingLegacyReset.status, 307);
  assert.equal(
    new URL(missingLegacyReset.headers.get("location") ?? "", origin).href,
    `${origin}/reset-password`
  );
  await missingLegacyReset.body?.cancel();

  for (const path of [
    "/events/new",
    `/events/${eventSlug}/edit`,
    "/teams/new"
  ]) {
    const response = await smokeFetch(
      `${origin}${path}`,
      { redirect: "manual" },
      overallSignal
    );
    assert.equal(
      response.status,
      307,
      `Anonymous GET ${path} must retain the temporary redirect status`
    );
    const destination = new URL(response.headers.get("location") ?? "", origin);
    assert.equal(destination.pathname, "/login", `GET ${path} must redirect to login`);
    assert.equal(
      destination.searchParams.get("next"),
      path,
      `GET ${path} must retain its exact local return path`
    );
    await response.body?.cancel();
  }

  const missingEdit = await smokeFetch(
    `${origin}/events/${missingEventSlug}/edit`,
    {
      headers: { cookie: `cgn_session=${sessionToken}` },
      redirect: "manual"
    },
    overallSignal
  );
  assert.equal(
    missingEdit.status,
    404,
    "Authenticated editing of a missing event must return HTTP 404"
  );
  await missingEdit.body?.cancel();

  assert.equal(
    upstreamCalls.some((call) =>
      call.method !== "GET" && [
        "/auth/signup",
        "/auth/forgot-password",
        "/auth/reset-password",
        "/auth/verify-email"
      ].includes(call.pathname)
    ),
    false,
    "Rendering Phase 4 pages must never trigger an authentication mutation"
  );
}

async function verifyEventBrowse(origin, upstreamCalls, overallSignal) {
  const callsBefore = upstreamCalls.length;
  const response = await smokeFetch(
    `${origin}/events?game=smoke-arena&school=${schoolSlug}&format=in_person`,
    {},
    overallSignal
  );
  assert.equal(response.status, 200, "GET /events must return HTTP 200");
  assert.equal(
    response.headers.get("cache-control"),
    "public, max-age=0, must-revalidate",
    "Anonymous event browse responses must remain viewer-safe"
  );
  const html = await response.text();
  assertSSRDocumentShell(html, "Event browse");
  assert.match(
    html,
    /<title>Events \| Campus Gaming Network<\/title>/i,
    "Event browse must render its route metadata"
  );
  assert.match(
    html,
    /<h1[^>]*>Browse campus gaming events<\/h1>/i,
    "Event browse must render its heading"
  );
  assert.ok(
    html.includes("Public Smoke Tournament") &&
      html.includes("Smoke Test University"),
    "Event browse must render validated public event data"
  );
  assert.ok(
    !html.includes("private-event-browse-note"),
    "Event browse HTML must strip additive upstream fields"
  );

  const calls = upstreamCalls.slice(callsBefore);
  const browseCall = oneUpstreamCall(calls, "GET", "/events");
  assert.equal(
    browseCall.search,
    `?game=smoke-arena&school=${schoolSlug}&format=in_person&limit=25`,
    "Event browse must forward normalized filters and its bounded page size"
  );
  oneUpstreamCall(calls, "GET", "/games");
  assert.equal(
    matchingUpstreamCalls(calls, "GET", "/me").length,
    0,
    "Anonymous event browse must not call /me"
  );
}

async function verifyTeamRoutes(origin, upstreamCalls, overallSignal) {
  const browseCallsBefore = upstreamCalls.length;
  const browseResponse = await smokeFetch(
    `${origin}/teams?game=smoke-arena&school=${schoolSlug}`,
    {},
    overallSignal
  );
  assert.equal(browseResponse.status, 200, "GET /teams must return HTTP 200");
  assert.equal(
    browseResponse.headers.get("cache-control"),
    "public, max-age=0, must-revalidate",
    "Anonymous team browse responses must remain viewer-safe"
  );
  const browseHTML = await browseResponse.text();
  assertSSRDocumentShell(browseHTML, "Team browse");
  assert.match(
    browseHTML,
    /<title>Teams \| Campus Gaming Network<\/title>/i,
    "Team browse must render its route metadata"
  );
  assert.match(
    browseHTML,
    /<h1[^>]*>Find campus gaming teams<\/h1>/i,
    "Team browse must render its heading"
  );
  assert.ok(
    browseHTML.includes("Smoke Arena Team"),
    "Team browse must render validated public team data"
  );
  assert.ok(
    !browseHTML.includes("private-team-note"),
    "Team browse HTML must strip additive upstream fields"
  );
  const browseCalls = upstreamCalls.slice(browseCallsBefore);
  const browseCall = oneUpstreamCall(browseCalls, "GET", "/teams");
  assert.equal(
    browseCall.search,
    `?game=smoke-arena&school=${schoolSlug}&limit=25`,
    "Team browse must forward normalized filters and its bounded page size"
  );
  oneUpstreamCall(browseCalls, "GET", "/games");

  const detailCallsBefore = upstreamCalls.length;
  const detailResponse = await smokeFetch(
    `${origin}/teams/${teamSlug}`,
    {},
    overallSignal
  );
  assert.equal(
    detailResponse.status,
    200,
    "A known team detail must return HTTP 200"
  );
  assert.equal(
    detailResponse.headers.get("cache-control"),
    "public, max-age=0, must-revalidate",
    "Anonymous team detail responses must remain viewer-safe"
  );
  const detailHTML = await detailResponse.text();
  assert.match(
    detailHTML,
    /<title>Smoke Arena Team \| Campus Gaming Network<\/title>/i,
    "Team detail must use metadata from the same safe DTO as its body"
  );
  assert.match(
    detailHTML,
    /<h1[^>]*>Smoke Arena Team<\/h1>/i,
    "Team detail must render its team heading"
  );
  for (const privateValue of [
    "private-team-note",
    "private-owner-user-id",
    "private-member@example.test"
  ]) {
    assert.ok(
      !detailHTML.includes(privateValue),
      `Team detail HTML must not serialize ${privateValue}`
    );
  }
  const detailCalls = upstreamCalls.slice(detailCallsBefore);
  oneUpstreamCall(detailCalls, "GET", `/teams/${teamSlug}`);
  assert.equal(
    matchingUpstreamCalls(detailCalls, "GET", "/me").length,
    0,
    "Anonymous team detail must not call /me"
  );

  const missingResponse = await smokeFetch(
    `${origin}/teams/${missingTeamSlug}`,
    {},
    overallSignal
  );
  assert.equal(
    missingResponse.status,
    404,
    "A missing team must return a true HTTP 404"
  );
  assert.match(
    await missingResponse.text(),
    /<title>Page not found \| Campus Gaming Network<\/title>/i,
    "A missing team must render the shared safe not-found metadata"
  );
}

async function verifySchoolRoutes(origin, upstreamCalls, overallSignal) {
  const browseCallsBefore = upstreamCalls.length;
  const browseResponse = await smokeFetch(
    `${origin}/schools?q=Smoke&state=CA`,
    {},
    overallSignal
  );
  assert.equal(browseResponse.status, 200, "GET /schools must return HTTP 200");
  assert.equal(
    browseResponse.headers.get("cache-control"),
    "public, max-age=0, must-revalidate",
    "Anonymous school browse responses must remain viewer-safe"
  );
  const browseHTML = await browseResponse.text();
  assertSSRDocumentShell(browseHTML, "School browse");
  assert.match(
    browseHTML,
    /<title>Schools \| Campus Gaming Network<\/title>/i,
    "School browse must render its route metadata"
  );
  assert.match(
    browseHTML,
    /<h1[^>]*>Browse schools<\/h1>/i,
    "School browse must render its heading"
  );
  assert.ok(
    browseHTML.includes("Smoke Test University"),
    "School browse must render validated catalog data"
  );
  const browseCall = oneUpstreamCall(
    upstreamCalls.slice(browseCallsBefore),
    "GET",
    "/schools"
  );
  assert.equal(
    browseCall.search,
    "?q=Smoke&state=CA&limit=25",
    "School browse must forward the normalized query, state, and page size"
  );

  const detailCallsBefore = upstreamCalls.length;
  const detailResponse = await smokeFetch(
    `${origin}/schools/${schoolSlug}`,
    {},
    overallSignal
  );
  assert.equal(
    detailResponse.status,
    200,
    "A known school detail must return HTTP 200"
  );
  assert.equal(
    detailResponse.headers.get("cache-control"),
    "private, no-store",
    "Viewer-aware school detail responses must never be shared"
  );
  const detailHTML = await detailResponse.text();
  assert.match(
    detailHTML,
    /<title>Smoke Test University \| Campus Gaming Network<\/title>/i,
    "School detail must use metadata from the same safe DTO as its body"
  );
  assert.match(
    detailHTML,
    /<h1[^>]*>Smoke Test University<\/h1>/i,
    "School detail must render the school heading"
  );
  assert.ok(
    !detailHTML.includes("private-school-note"),
    "School detail HTML must strip additive upstream fields"
  );
  const detailCalls = upstreamCalls.slice(detailCallsBefore);
  oneUpstreamCall(detailCalls, "GET", `/schools/${schoolSlug}`);
  assert.equal(
    matchingUpstreamCalls(detailCalls, "GET", "/me").length,
    0,
    "Anonymous school detail must not call /me"
  );

  const missingResponse = await smokeFetch(
    `${origin}/schools/${missingSchoolSlug}`,
    {},
    overallSignal
  );
  assert.equal(
    missingResponse.status,
    404,
    "A missing school must return a true HTTP 404"
  );
  assert.match(
    await missingResponse.text(),
    /<title>Page not found \| Campus Gaming Network<\/title>/i,
    "A missing school must render the shared safe not-found metadata"
  );
}

async function verifyPublicProfileRoutes(
  origin,
  upstreamCalls,
  overallSignal
) {
  const callsBefore = upstreamCalls.length;
  const response = await smokeFetch(
    `${origin}/users/${publicProfileID}`,
    {},
    overallSignal
  );
  assert.equal(response.status, 200, "A known public profile must return HTTP 200");
  assert.equal(
    response.headers.get("cache-control"),
    "public, max-age=0, must-revalidate",
    "Anonymous public-profile responses must remain viewer-safe"
  );
  const html = await response.text();
  assert.match(
    html,
    /<title>Public Smoke Player \| Campus Gaming Network<\/title>/i,
    "Public profile must render dynamic metadata"
  );
  assert.match(
    html,
    /<h1[^>]*>Public Smoke Player<\/h1>/i,
    "Public profile must render its public name"
  );
  for (const privateValue of [
    "private-profile@example.test",
    "private-profile-session",
    "private-profile-internal-header"
  ]) {
    assert.ok(
      !html.includes(privateValue),
      `Public-profile HTML must not serialize ${privateValue}`
    );
  }
  const calls = upstreamCalls.slice(callsBefore);
  oneUpstreamCall(calls, "GET", `/users/${publicProfileID}`);
  assert.equal(
    matchingUpstreamCalls(calls, "GET", "/me").length,
    0,
    "Anonymous public-profile rendering must not call /me"
  );

  const missingResponse = await smokeFetch(
    `${origin}/users/${missingPublicProfileID}`,
    {},
    overallSignal
  );
  assert.equal(
    missingResponse.status,
    404,
    "A missing public profile must return a true HTTP 404"
  );
}

async function verifySchoolsAPI(origin, overallSignal) {
  const valid = await smokeFetch(
    `${origin}/api/schools?q=Smoke&limit=500`,
    {},
    overallSignal
  );
  assert.equal(valid.status, 200, "Valid school search API input must return 200");
  assert.equal(
    valid.headers.get("cache-control"),
    "private, max-age=60",
    "School search API responses must preserve the short private cache contract"
  );
  const body = await valid.json();
  assert.equal(body.limit, 50, "School search API limits must clamp to 50");
  assert.equal(body.schools[0]?.name, "Smoke Test University");
  assert.equal(
    JSON.stringify(body).includes("private-school-note"),
    false,
    "School search API responses must strip additive upstream fields"
  );

  const invalid = await smokeFetch(
    `${origin}/api/schools?q=x`,
    {},
    overallSignal
  );
  assert.equal(invalid.status, 400, "Short school search API input must fail");
  assert.deepEqual(await invalid.json(), { error: "invalid_school_query" });

  const head = await smokeFetch(
    `${origin}/api/schools?q=Smoke`,
    { method: "HEAD" },
    overallSignal
  );
  assert.equal(head.status, 200, "HEAD /api/schools must return 200");
  assert.equal(
    head.headers.get("cache-control"),
    "private, max-age=60",
    "HEAD /api/schools must preserve the school cache contract"
  );
  assert.equal(await head.text(), "", "HEAD /api/schools must not return a body");

  await verifyUnsupportedAPIMethods(
    origin,
    "/api/schools?q=Smoke",
    overallSignal
  );
}

async function verifyAuthenticatedWritePages(
  origin,
  cookies,
  upstreamCalls,
  overallSignal
) {
  const callsBefore = upstreamCalls.length;
  const pages = [
    {
      path: "/events/new",
      title: "Create event",
      heading: "Create a campus gaming event"
    },
    {
      path: `/events/${eventSlug}/edit`,
      title: "Edit event",
      heading: privateEventSecrets.title
    },
    {
      path: "/teams/new",
      title: "Start a team",
      heading: "Create a campus gaming team"
    }
  ];

  for (const page of pages) {
    const response = await smokeFetch(
      `${origin}${page.path}`,
      { headers: { cookie: cookies } },
      overallSignal
    );
    assert.equal(
      response.status,
      200,
      `Authenticated GET ${page.path} must return 200`
    );
    assert.equal(
      response.headers.get("cache-control"),
      "private, no-store",
      `Authenticated GET ${page.path} must never be shared or cached`
    );
    assert.match(
      response.headers.get("vary") ?? "",
      /(?:^|,\s*)Cookie(?:,|$)/i,
      `Authenticated GET ${page.path} must vary by Cookie`
    );
    const html = await response.text();
    assertSSRDocumentShell(html, `Authenticated GET ${page.path}`);
    assert.match(
      html,
      new RegExp(
        `<title>${escapeRegularExpression(page.title)} \\| Campus Gaming Network<\\/title>`,
        "i"
      ),
      `Authenticated GET ${page.path} must render private route metadata`
    );
    assert.match(
      html,
      /<meta\s+name="robots"\s+content="noindex,nofollow"\s*\/?>/i,
      `Authenticated GET ${page.path} must remain noindex`
    );
    assert.ok(
      html.includes(page.heading),
      `Authenticated GET ${page.path} must render its primary heading`
    );
  }

  const calls = upstreamCalls.slice(callsBefore);
  assert.ok(
    matchingUpstreamCalls(calls, "GET", "/me").length >= pages.length,
    "Authenticated write pages must authorize from the request session"
  );
  oneUpstreamCall(calls, "GET", `/events/${eventSlug}`);
}

async function verifyHealthRoute(origin, overallSignal) {
  const response = await smokeFetch(`${origin}/api/health`, {}, overallSignal);
  assert.equal(
    response.status,
    200,
    "GET /api/health must return HTTP 200 when the fake Go API is healthy"
  );
  assert.match(
    response.headers.get("content-type") ?? "",
    /^application\/json\b/i,
    "GET /api/health must return JSON"
  );
  assert.deepEqual(
    await response.json(),
    {
      service: "campus-gaming-network-web",
      status: "ok",
      api: {
        service: fakeAPIHealthPayload.service,
        status: fakeAPIHealthPayload.status
      }
    },
    "GET /api/health must return the exact web envelope and allowlisted API payload"
  );
}

async function verifyHealthMethodBoundary(origin, overallSignal) {
  const head = await smokeFetch(
    `${origin}/api/health`,
    { method: "HEAD" },
    overallSignal
  );
  assert.equal(head.status, 200, "HEAD /api/health must return HTTP 200");
  assert.equal(await head.text(), "", "HEAD /api/health must not return a body");

  for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
    const response = await smokeFetch(
      `${origin}/api/health`,
      { method },
      overallSignal
    );
    assert.equal(
      response.status,
      405,
      `${method} /api/health must return HTTP 405`
    );
    assert.equal(
      response.headers.get("allow"),
      "GET, HEAD",
      `${method} /api/health must advertise exactly Allow: GET, HEAD`
    );
    await response.body?.cancel();
  }
}

async function verifyNavigationSessionRoute(
  origin,
  upstreamCalls,
  overallSignal
) {
  const meCallsBefore = matchingUpstreamCalls(
    upstreamCalls,
    "GET",
    "/me"
  ).length;
  const anonymousResponse = await smokeFetch(
    `${origin}/api/navigation-session`,
    {},
    overallSignal
  );
  assert.equal(
    anonymousResponse.status,
    200,
    "Anonymous GET /api/navigation-session must return HTTP 200"
  );
  assert.equal(
    anonymousResponse.headers.get("cache-control"),
    "private, no-store",
    "Anonymous navigation-session response must be private, no-store"
  );
  assert.deepEqual(
    await anonymousResponse.json(),
    { authenticated: false },
    "Anonymous navigation-session response must be exactly authenticated=false"
  );
  assert.equal(
    matchingUpstreamCalls(upstreamCalls, "GET", "/me").length,
    meCallsBefore,
    "Anonymous navigation-session lookup must not call upstream /me"
  );

  const authenticatedCallsBefore = upstreamCalls.length;
  const authenticatedResponse = await smokeFetch(
    `${origin}/api/navigation-session`,
    { headers: { cookie: `cgn_session=${sessionToken}` } },
    overallSignal
  );
  assert.equal(
    authenticatedResponse.status,
    200,
    "Authenticated GET /api/navigation-session must return HTTP 200"
  );
  assert.equal(
    authenticatedResponse.headers.get("cache-control"),
    "private, no-store",
    "Authenticated navigation-session response must be private, no-store"
  );
  assert.deepEqual(
    await authenticatedResponse.json(),
    { authenticated: true },
    "Exact-session navigation response must be exactly authenticated=true"
  );
  const meCall = oneUpstreamCall(
    upstreamCalls.slice(authenticatedCallsBefore),
    "GET",
    "/me"
  );
  assert.equal(
    meCall.cookie,
    `cgn_session=${sessionToken}`,
    "Authenticated navigation-session lookup must forward the exact session cookie"
  );

  const headResponse = await smokeFetch(
    `${origin}/api/navigation-session`,
    { method: "HEAD" },
    overallSignal
  );
  assert.equal(
    headResponse.status,
    200,
    "HEAD /api/navigation-session must return HTTP 200"
  );
  assert.equal(
    headResponse.headers.get("cache-control"),
    "private, no-store",
    "HEAD /api/navigation-session must preserve the no-store contract"
  );
  assert.equal(
    await headResponse.text(),
    "",
    "HEAD /api/navigation-session must not return a body"
  );

  await verifyUnsupportedAPIMethods(
    origin,
    "/api/navigation-session",
    overallSignal
  );
}

async function verifyUnsupportedAPIMethods(origin, path, overallSignal) {
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
    const response = await smokeFetch(
      `${origin}${path}`,
      { method, redirect: "manual" },
      overallSignal
    );
    assert.equal(
      response.status,
      405,
      `${method} ${path} must return HTTP 405`
    );
    assert.equal(
      response.headers.get("allow"),
      "GET, HEAD",
      `${method} ${path} must advertise exactly Allow: GET, HEAD`
    );
    await response.body?.cancel();
  }
}

async function verifyNotFoundPage(origin, overallSignal) {
  const response = await smokeFetch(
    `${origin}/__web_smoke_missing__`,
    {},
    overallSignal
  );
  assert.equal(response.status, 404, "Unknown routes must return a true HTTP 404");

  const html = await response.text();
  assertSSRDocumentShell(html, "Unknown route");
  assert.match(
    html,
    /<title>Page not found \| Campus Gaming Network<\/title>/i,
    "Unknown-route SSR output must include the not-found title"
  );
  assert.match(
    html,
    /<meta\s+name="robots"\s+content="noindex,nofollow"\s*\/?>/i,
    "Unknown-route SSR output must include noindex,nofollow robots metadata"
  );
  assert.match(
    html,
    /<h1[^>]*>We could not find that page\.<\/h1>/i,
    "Unknown-route SSR output must include the not-found heading"
  );
}

async function verifyEventNotFound(origin, upstreamCalls, overallSignal) {
  const callsBefore = upstreamCalls.length;
  const response = await smokeFetch(
    `${origin}/events/${missingEventSlug}`,
    {},
    overallSignal
  );
  assert.equal(
    response.status,
    404,
    "A missing event must return a true HTTP 404"
  );

  const html = await response.text();
  assertSSRDocumentShell(html, "Missing event");
  assert.match(
    html,
    /<title>Page not found \| Campus Gaming Network<\/title>/i,
    "A missing event must render the safe not-found title"
  );
  assert.match(
    html,
    /<meta\s+name="robots"\s+content="noindex,nofollow"\s*\/?>/i,
    "A missing event must be noindex"
  );

  const eventCall = oneUpstreamCall(
    upstreamCalls.slice(callsBefore),
    "GET",
    `/events/${missingEventSlug}`
  );
  assert.equal(
    eventCall.eventUnlock,
    undefined,
    "A missing-event request must not invent an unlock token"
  );
}

async function verifyLockedEvent(origin, upstreamCalls, overallSignal) {
  const callsBefore = upstreamCalls.length;
  const response = await smokeFetch(
    `${origin}/events/${eventSlug}`,
    {},
    overallSignal
  );
  assert.equal(
    response.status,
    200,
    "A locked private event must return its generic HTTP 200 shell"
  );
  assert.equal(
    response.headers.get("cache-control"),
    "private, no-store",
    "Locked event responses must never be shared or cached"
  );

  const html = await response.text();
  assertSSRDocumentShell(html, "Locked event");
  assert.match(
    html,
    /<title>Private event \| Campus Gaming Network<\/title>/i,
    "A locked private event must use generic metadata"
  );
  assert.match(
    html,
    /<meta\s+name="robots"\s+content="noindex,nofollow"\s*\/?>/i,
    "A locked private event must be noindex"
  );
  assert.match(
    html,
    /<h1[^>]*>This event is private\.<\/h1>/i,
    "A locked private event must render the generic heading"
  );

  for (const secret of [
    ...Object.values(privateEventSecrets),
    eventPassword,
    unlockToken,
    sessionToken,
    outageSessionToken
  ]) {
    assert.ok(
      !html.includes(secret),
      `Locked-event HTML must not contain private value: ${secret}`
    );
  }

  const eventCall = oneUpstreamCall(
    upstreamCalls.slice(callsBefore),
    "GET",
    `/events/${eventSlug}`
  );
  assert.equal(
    eventCall.eventUnlock,
    undefined,
    "The initial locked-event request must not send an unlock token"
  );
  return html;
}

async function verifyCrossOriginPostRejected(
  origin,
  loginAction,
  upstreamCalls,
  overallSignal
) {
  const loginCallsBefore = matchingUpstreamCalls(
    upstreamCalls,
    "POST",
    "/auth/login"
  ).length;
  const response = await postNativeForm(
    loginAction,
    {
      email: "player@example.test",
      password: "Password12345!",
      next: `/events/${eventSlug}`
    },
    {
      originHeader: "https://attacker.example",
      overallSignal
    }
  );
  assert.ok(
    response.status >= 400 && response.status < 500,
    `Cross-origin native form POST must be rejected with a 4xx response, received ${response.status}`
  );
  await response.body?.cancel();
  assert.equal(
    matchingUpstreamCalls(upstreamCalls, "POST", "/auth/login").length,
    loginCallsBefore,
    "A rejected cross-origin login must not call the upstream API"
  );
  assert.equal(
    new URL(loginAction).origin,
    origin,
    "Discovered login action must stay on the Start origin"
  );
}

async function verifyNativeLogin(
  origin,
  loginAction,
  upstreamCalls,
  overallSignal
) {
  const callsBefore = upstreamCalls.length;
  const response = await postNativeForm(
    loginAction,
    {
      email: "player@example.test",
      password: "Password12345!",
      next: `/events/${eventSlug}`
    },
    { originHeader: origin, overallSignal }
  );
  assertRedirect(
    response,
    origin,
    `/events/${eventSlug}`,
    "Native login"
  );
  const sessionCookie = assertResponseCookie(
    response,
    "cgn_session",
    sessionToken,
    "Native login"
  );

  const loginCall = oneUpstreamCall(
    upstreamCalls.slice(callsBefore),
    "POST",
    "/auth/login"
  );
  assert.deepEqual(
    loginCall.body,
    {
      email: "player@example.test",
      password: "Password12345!"
    },
    "Native login must send the expected JSON upstream without the local next path"
  );
  return sessionCookie;
}

async function verifyAuthenticatedViewerOutage(
  origin,
  upstreamCalls,
  overallSignal
) {
  const callsBefore = upstreamCalls.length;
  const response = await smokeFetch(
    `${origin}/events/${eventSlug}`,
    { headers: { cookie: `cgn_session=${outageSessionToken}` } },
    overallSignal
  );
  assert.equal(
    response.status,
    500,
    "A non-401 /me outage for an apparent session must return a route error"
  );

  const html = await response.text();
  assertSSRDocumentShell(html, "Authenticated /me outage");
  assert.match(
    html,
    /<h1[^>]*>We could not load this event\.<\/h1>/i,
    "An authenticated /me outage must render the safe event error boundary"
  );
  assert.ok(
    !/<a\b[^>]*>Log in to RSVP<\/a>/i.test(html) &&
      !/<h1[^>]*>This event is private\.<\/h1>/i.test(html),
    "An authenticated /me outage must not render a false anonymous event page"
  );
  for (const unsafeValue of [
    outageSessionToken,
    "service_unavailable",
    privateEventSecrets.title,
    privateEventSecrets.description
  ]) {
    assert.ok(
      !html.includes(unsafeValue),
      `Authenticated outage HTML must not expose upstream/private value: ${unsafeValue}`
    );
  }

  const meCalls = matchingUpstreamCalls(
    upstreamCalls.slice(callsBefore),
    "GET",
    "/me"
  );
  assert.equal(
    meCalls.length,
    1,
    "The shared strict viewer-session boundary must verify the apparent session once"
  );
  for (const meCall of meCalls) {
    assert.match(
      meCall.cookie ?? "",
      new RegExp(`(?:^|;\\s*)cgn_session=${outageSessionToken}(?:;|$)`),
      "Each viewer-session check must forward the apparent session upstream"
    );
  }
}

async function verifyNativeUnlock(
  origin,
  unlockAction,
  sessionCookie,
  upstreamCalls,
  overallSignal
) {
  const callsBefore = upstreamCalls.length;
  const response = await postNativeForm(
    unlockAction,
    { slug: eventSlug, password: eventPassword },
    {
      cookie: sessionCookie,
      originHeader: origin,
      overallSignal
    }
  );
  assertRedirect(
    response,
    origin,
    `/events/${eventSlug}?event=unlocked`,
    "Native event unlock"
  );
  const unlockCookie = assertResponseCookie(
    response,
    `cgn_event_unlock_${eventSlug}`,
    unlockToken,
    "Native event unlock"
  );

  const unlockCall = oneUpstreamCall(
    upstreamCalls.slice(callsBefore),
    "POST",
    `/events/${eventSlug}/unlock`
  );
  assert.deepEqual(
    unlockCall.body,
    { password: eventPassword },
    "Native unlock must send only the event password upstream"
  );
  return unlockCookie;
}

async function verifyUnlockedEvent(
  origin,
  cookies,
  upstreamCalls,
  overallSignal
) {
  const callsBefore = upstreamCalls.length;
  const response = await smokeFetch(
    `${origin}/events/${eventSlug}?event=unlocked`,
    { headers: { cookie: cookies } },
    overallSignal
  );
  assert.equal(response.status, 200, "An unlocked event must return HTTP 200");
  assert.equal(
    response.headers.get("cache-control"),
    "private, no-store",
    "Unlocked viewer-aware event responses must never be shared or cached"
  );

  const html = await response.text();
  assertSSRDocumentShell(html, "Unlocked event");
  assert.match(
    html,
    new RegExp(`<title>${escapeRegularExpression(privateEventSecrets.title)} \\| Campus Gaming Network<\\/title>`, "i"),
    "An unlocked event must render its real title"
  );
  assert.match(
    html,
    new RegExp(
      `<meta\\s+property="og:url"\\s+content="${escapeRegularExpression(`${origin}/events/${eventSlug}`)}"\\s*\\/?>`,
      "i"
    ),
    "An unlocked event must emit an absolute Open Graph URL"
  );
  assert.ok(
    html.includes(privateEventSecrets.description),
    "An unlocked event must render its real description"
  );
  assert.ok(
    !html.includes(unlockToken) && !html.includes(sessionToken),
    "Unlocked-event HTML must not serialize cookie tokens"
  );

  const calls = upstreamCalls.slice(callsBefore);
  const eventCall = oneUpstreamCall(calls, "GET", `/events/${eventSlug}`);
  assert.equal(
    eventCall.eventUnlock,
    unlockToken,
    "Unlocked event read must forward its unlock token upstream"
  );
  const meCalls = matchingUpstreamCalls(calls, "GET", "/me");
  assert.equal(
    meCalls.length,
    1,
    "The shared viewer-session boundary must verify the session once"
  );
  for (const meCall of meCalls) {
    assert.ok(
      meCall.cookie?.includes(`cgn_session=${sessionToken}`),
      "Unlocked event session checks must forward the session upstream"
    );
  }
  return html;
}

async function verifyNativeRSVP(
  origin,
  rsvpAction,
  cookies,
  upstreamCalls,
  overallSignal
) {
  const callsBefore = upstreamCalls.length;
  const response = await postNativeForm(
    rsvpAction,
    { slug: eventSlug, response: "yes" },
    { cookie: cookies, originHeader: origin, overallSignal }
  );
  assertRedirect(
    response,
    origin,
    `/events/${eventSlug}?event=rsvp-updated`,
    "Native RSVP"
  );

  const rsvpCall = oneUpstreamCall(
    upstreamCalls.slice(callsBefore),
    "POST",
    `/events/${eventSlug}/rsvp`
  );
  assert.deepEqual(
    rsvpCall.body,
    { response: "yes" },
    "Native RSVP must send the selected response upstream"
  );
  assert.ok(
    rsvpCall.cookie?.includes(`cgn_session=${sessionToken}`),
    "Native RSVP must forward the session cookie upstream"
  );
  assert.equal(
    rsvpCall.eventUnlock,
    unlockToken,
    "Native RSVP must forward the private-event unlock token upstream"
  );
}

async function verifyNativeLogout(
  origin,
  logoutAction,
  cookies,
  upstreamCalls,
  overallSignal
) {
  const callsBefore = upstreamCalls.length;
  const response = await postNativeForm(
    logoutAction,
    {},
    { cookie: cookies, originHeader: origin, overallSignal }
  );
  assertRedirect(response, origin, "/", "Native logout");
  assertResponseCookieDeletion(response, "cgn_session", "Native logout");

  const logoutCall = oneUpstreamCall(
    upstreamCalls.slice(callsBefore),
    "POST",
    "/auth/logout"
  );
  assert.ok(
    logoutCall.cookie?.includes(`cgn_session=${sessionToken}`),
    "Native logout must forward the incoming session cookie upstream"
  );
}

async function getHTML(url, overallSignal, label) {
  const response = await smokeFetch(url, {}, overallSignal);
  assert.equal(response.status, 200, `${label} must return HTTP 200`);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
    `${label} must return HTML`
  );
  return response.text();
}

function discoverFormAction(html, className, origin) {
  for (const match of html.matchAll(/<form\b[^>]*>/gi)) {
    const formTag = match[0];
    const classes = htmlAttribute(formTag, "class")?.split(/\s+/) ?? [];
    if (!classes.includes(className)) {
      continue;
    }

    const action = htmlAttribute(formTag, "action");
    assert.ok(action, `Form with class ${className} must have an action URL`);
    const actionURL = new URL(decodeHTMLEntities(action), origin);
    assert.equal(
      actionURL.origin,
      origin,
      `Form with class ${className} must submit to the Start origin`
    );
    return actionURL.href;
  }

  assert.fail(`Rendered HTML did not contain a form with class ${className}`);
}

function htmlAttribute(tag, name) {
  const escapedName = escapeRegularExpression(name);
  const match = tag.match(
    new RegExp(`\\b${escapedName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i")
  );
  return match?.[1] ?? match?.[2] ?? match?.[3];
}

function decodeHTMLEntities(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&#x27;", "'");
}

async function postNativeForm(
  action,
  fields,
  { cookie, originHeader, overallSignal }
) {
  const headers = {
    accept: "text/html",
    "content-type": "application/x-www-form-urlencoded",
    origin: originHeader,
    ...(cookie ? { cookie } : {})
  };
  return smokeFetch(
    action,
    {
      method: "POST",
      headers,
      body: new URLSearchParams(fields),
      redirect: "manual"
    },
    overallSignal
  );
}

function assertRedirect(response, origin, destination, label) {
  assert.equal(response.status, 303, `${label} must return HTTP 303`);
  const location = response.headers.get("location");
  assert.ok(location, `${label} must return a Location header`);
  const resolved = new URL(location, origin);
  assert.equal(
    `${resolved.pathname}${resolved.search}`,
    destination,
    `${label} must redirect to ${destination}`
  );
}

function assertSensitiveValuesAbsentFromLogs(logs) {
  for (const sensitiveValue of [
    "player@example.test",
    "Password12345!",
    eventPassword,
    unlockToken,
    sessionToken,
    outageSessionToken,
    "smoke-reset-token",
    "smoke-verification-token",
    "legacy-smoke-token",
    "local-smoke-proxy-secret-not-for-production",
    "local-smoke-cloudflare-secret-not-for-production"
  ]) {
    assert.ok(
      !logs.includes(sensitiveValue),
      "Production logs must not contain submitted PII, credentials, tokens, or deployment secrets"
    );
  }
}

function assertResponseCookie(response, name, value, label) {
  const cookie = response.headers
    .getSetCookie()
    .find((candidate) => candidate.startsWith(`${name}=`));
  assert.ok(cookie, `${label} must set ${name}`);
  assert.equal(
    cookie.split(";", 1)[0],
    `${name}=${value}`,
    `${label} must set the expected opaque ${name} value`
  );
  for (const attribute of ["Path=/", "HttpOnly", "Secure", "SameSite=Lax"]) {
    assert.match(
      cookie,
      new RegExp(`(?:^|;\\s*)${escapeRegularExpression(attribute)}(?:;|$)`, "i"),
      `${label} ${name} cookie must include ${attribute}`
    );
  }
  return `${name}=${value}`;
}

function assertResponseCookieDeletion(response, name, label) {
  const cookie = response.headers
    .getSetCookie()
    .find((candidate) => candidate.startsWith(`${name}=`));
  assert.ok(cookie, `${label} must delete ${name}`);
  assert.equal(
    cookie.split(";", 1)[0],
    `${name}=`,
    `${label} must clear the configured cookie value`
  );
  assert.match(
    cookie,
    /(?:^|;\s*)Path=\/(?:;|$)/i,
    `${label} must delete the configured cookie at the root path`
  );

  const maxAge = cookie.match(/(?:^|;\s*)Max-Age=(-?\d+)(?:;|$)/i)?.[1];
  const expires = cookie.match(/(?:^|;\s*)Expires=([^;]+)(?:;|$)/i)?.[1];
  assert.ok(
    (maxAge !== undefined && Number(maxAge) <= 0) ||
      (expires !== undefined && new Date(expires).getTime() <= Date.now()),
    `${label} must expire the configured local cookie`
  );
}

function oneUpstreamCall(calls, method, pathname) {
  const matches = matchingUpstreamCalls(calls, method, pathname);
  assert.equal(
    matches.length,
    1,
    `Expected exactly one upstream ${method} ${pathname} call, received ${matches.length}`
  );
  return matches[0];
}

function matchingUpstreamCalls(calls, method, pathname) {
  return calls.filter(
    (call) => call.method === method && call.pathname === pathname
  );
}

function escapeRegularExpression(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assertSSRDocumentShell(html, label) {
  assert.match(html, /<!DOCTYPE html>/i, `${label} must include a doctype`);
  assert.match(html, /<html\b[^>]*lang="en"/i, `${label} must include the HTML shell`);
  assert.match(html, /<header\b[^>]*class="site-header"/i, `${label} must include the site header`);
  assert.match(html, /<nav\b[^>]*aria-label="Main navigation"/i, `${label} must include main navigation`);
  assert.match(html, /<footer\b[^>]*class="site-footer"/i, `${label} must include the site footer`);
}

async function smokeFetch(url, options, overallSignal) {
  const requestSignal = AbortSignal.any([
    overallSignal,
    AbortSignal.timeout(requestTimeoutMilliseconds)
  ]);

  try {
    return await fetch(url, { ...options, signal: requestSignal });
  } catch (error) {
    if (overallSignal.aborted) {
      throw overallSignal.reason;
    }
    throw new Error(`Request failed for ${options.method ?? "GET"} ${url}`, {
      cause: error
    });
  }
}

async function waitForWebServer(origin, child, output, overallSignal) {
  const deadline = Date.now() + startupTimeoutMilliseconds;

  while (Date.now() < deadline) {
    if (overallSignal.aborted) {
      throw overallSignal.reason;
    }
    if (output.spawnError) {
      throw new Error("Unable to spawn the Node 24 production launcher", {
        cause: output.spawnError
      });
    }
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `Production launcher exited before becoming ready (code=${String(child.exitCode)}, signal=${String(child.signalCode)})`
      );
    }

    try {
      const response = await fetch(`${origin}/`, {
        signal: AbortSignal.timeout(500)
      });
      await response.body?.cancel();
      return;
    } catch {
      await delay(100, undefined, { signal: overallSignal });
    }
  }

  throw new Error(
    `Production launcher did not accept HTTP requests within ${startupTimeoutMilliseconds}ms`
  );
}

async function startFakeAPI(signal) {
  const calls = [];
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

async function handleFakeAPIRequest(request, response, calls) {
  const method = request.method ?? "GET";
  const requestURL = new URL(request.url ?? "/", "http://fake-api.local");
  const body = await readJSONRequestBody(request);
  const call = {
    method,
    pathname: requestURL.pathname,
    search: requestURL.search,
    cookie: headerValue(request.headers.cookie),
    eventUnlock: headerValue(request.headers["x-cgn-event-unlock"]),
    body
  };
  calls.push(call);

  if ((method === "GET" || method === "HEAD") && requestURL.pathname === "/health") {
    writeJSON(response, 200, fakeAPIHealthPayload, { head: method === "HEAD" });
    return;
  }

  if (method === "GET" && requestURL.pathname === "/games") {
    writeJSON(response, 200, {
      games: [{ id: "game-smoke", name: "Smoke Arena", slug: "smoke-arena" }]
    });
    return;
  }

  if (method === "GET" && requestURL.pathname === "/events") {
    writeJSON(response, 200, {
      events: [fakePublicEvent()],
      limit: 25,
      has_more: false,
      has_previous: false
    });
    return;
  }

  if (method === "GET" && requestURL.pathname === "/teams") {
    writeJSON(response, 200, {
      teams: [fakeTeam()],
      limit: 25,
      has_more: false,
      has_previous: false
    });
    return;
  }

  if (
    method === "GET" &&
    requestURL.pathname === `/teams/${missingTeamSlug}`
  ) {
    writeJSON(response, 404, { error: "team_not_found" });
    return;
  }

  if (method === "GET" && requestURL.pathname === `/teams/${teamSlug}`) {
    writeJSON(response, 200, fakeTeam());
    return;
  }

  if (method === "GET" && requestURL.pathname === "/schools") {
    const limit = Number.parseInt(requestURL.searchParams.get("limit") ?? "25", 10);
    const offset = Number.parseInt(requestURL.searchParams.get("offset") ?? "0", 10);
    writeJSON(response, 200, {
      schools: [fakeSchool()],
      limit,
      offset,
      has_more: false
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

  if (
    method === "GET" &&
    requestURL.pathname === `/users/${publicProfileID}`
  ) {
    writeJSON(response, 200, fakePublicProfile());
    return;
  }

  if (method === "GET" && requestURL.pathname === `/events/${missingEventSlug}`) {
    writeJSON(response, 404, { error: "event_not_found" });
    return;
  }

  if (method === "GET" && requestURL.pathname === `/events/${eventSlug}`) {
    if (call.eventUnlock === unlockToken) {
      writeJSON(
        response,
        200,
        visibleEvent({
          viewerCanEdit: call.cookie?.includes(`cgn_session=${sessionToken}`)
        })
      );
    } else {
      writeJSON(response, 200, {
        slug: eventSlug,
        visibility: "private",
        locked: true
      });
    }
    return;
  }

  if (method === "GET" && requestURL.pathname === "/me/events") {
    writeJSON(response, 200, {
      upcoming_rsvps: [fakeAccountEvent("Smoke Dashboard RSVP", "yes")],
      followed_school_events: [fakeAccountEvent("Smoke Followed Event")]
    });
    return;
  }

  if (method === "GET" && requestURL.pathname === "/me/schools") {
    writeJSON(response, 200, { schools: [fakeSchool()] });
    return;
  }

  if (method === "GET" && requestURL.pathname === "/me/teams") {
    writeJSON(response, 200, {
      teams: [{
        ...fakeTeam(),
        viewer_role: "member",
        members: [{ name: "private-account-member" }]
      }],
      limit: 10
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
          "set-cookie":
            `cgn_session=${sessionToken}; Path=/; Max-Age=3600; HttpOnly; Secure; SameSite=Lax`
        }
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
        expires_at: "2037-08-15T20:00:00Z"
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

function visibleEvent({ viewerRSVP, viewerCanEdit = false } = {}) {
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
    is_paid: false,
    host_school: {
      id: "school-smoke",
      name: "Smoke Test University",
      slug: "smoke-test-university",
      city: "Irvine",
      state: "CA"
    },
    games: [
      { id: "game-smoke", name: "Smoke Arena", slug: "smoke-arena" }
    ],
    organizers: [
      {
        id: "user-smoke",
        name: "Smoke Player",
        role: "creator",
        verification_level: "verified_student"
      }
    ],
    ...(viewerCanEdit ? { viewer_can_edit: true } : {}),
    ...(viewerRSVP === "yes" || viewerRSVP === "maybe" || viewerRSVP === "no"
      ? { viewer_rsvp: viewerRSVP }
      : {})
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
    host_school: { name: "Smoke Test University" },
    games: [{ name: "Smoke Arena" }],
    private_note: "private-event-browse-note"
  };
}

function fakeAccountEvent(title, viewerRSVP) {
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
    ...(viewerRSVP ? { viewer_rsvp: viewerRSVP } : {}),
    private_note: "account-event-private-note"
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
      state: "CA"
    },
    games: [
      { id: "game-smoke", name: "Smoke Arena", slug: "smoke-arena" }
    ],
    owner_user_id: "private-owner-user-id",
    members: [
      {
        user_id: "private-owner-user-id",
        name: "private-member@example.test",
        role: "member"
      }
    ],
    private_note: "private-team-note"
  };
}

function fakeProfile() {
  return {
    id: "user-smoke",
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
        url: "https://community.example.test/smoke-player"
      }
    ],
    role_indicators: [],
    password_hash: "account-password-hash",
    session: "account-session-secret"
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
    private_note: "private-school-note"
  };
}

function fakePublicProfile() {
  return {
    id: publicProfileID,
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
        url: "https://community.example.test/public-smoke-player"
      }
    ],
    role_indicators: ["school_admin"],
    email: "private-profile@example.test",
    session: "private-profile-session",
    internal_header: "private-profile-internal-header"
  };
}

async function readJSONRequestBody(request) {
  const chunks = [];
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
  return text.trim() ? JSON.parse(text) : undefined;
}

function writeJSON(response, status, payload, { head = false, headers = {} } = {}) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    ...headers
  });
  response.end(head ? undefined : body);
}

function headerValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

async function findAvailablePort(signal) {
  const server = createNetServer();
  const port = await listenOnEphemeralPort(server, signal);
  await closeServer(server);
  return port;
}

function listenOnEphemeralPort(server, signal) {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      server.close();
      reject(signal.reason);
    };
    const onError = (error) => {
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
        reject(new Error("Unable to determine dynamically selected localhost port"));
        return;
      }
      resolve(address.port);
    });
  });
}

function captureChildOutput(child) {
  const state = {
    stdout: "",
    stderr: "",
    stdoutTruncated: false,
    stderrTruncated: false,
    spawnError: undefined,
    format() {
      return [
        formatCapturedStream("child stdout", this.stdout, this.stdoutTruncated),
        formatCapturedStream("child stderr", this.stderr, this.stderrTruncated)
      ].join("");
    }
  };

  child.stdout?.on("data", (chunk) => {
    const result = appendBounded(state.stdout, chunk);
    state.stdout = result.value;
    state.stdoutTruncated ||= result.truncated;
  });
  child.stderr?.on("data", (chunk) => {
    const result = appendBounded(state.stderr, chunk);
    state.stderr = result.value;
    state.stderrTruncated ||= result.truncated;
  });
  child.once("error", (error) => {
    state.spawnError = error;
  });

  return state;
}

function appendBounded(current, chunk) {
  const combined = current + String(chunk);
  if (Buffer.byteLength(combined) <= maximumChildOutputBytes) {
    return { value: combined, truncated: false };
  }

  return {
    value: Buffer.from(combined).subarray(-maximumChildOutputBytes).toString(),
    truncated: true
  };
}

function formatCapturedStream(label, value, truncated) {
  if (!value) {
    return `--- ${label}: empty ---\n`;
  }
  return `--- ${label}${truncated ? " (leading output truncated)" : ""} ---\n${value}${value.endsWith("\n") ? "" : "\n"}`;
}

async function terminateChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  child.kill("SIGTERM");
  const exited = await Promise.race([
    waitForExit(child).then(() => true),
    delay(shutdownTimeoutMilliseconds).then(() => false)
  ]);

  if (!exited && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await Promise.race([
      waitForExit(child),
      delay(shutdownTimeoutMilliseconds)
    ]);
  }
}

function waitForExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolve) => child.once("exit", resolve));
}

async function closeServer(server) {
  if (!server?.listening) {
    return;
  }

  await Promise.race([
    new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections?.();
    }),
    delay(shutdownTimeoutMilliseconds)
  ]);
}

function findNode24Binary() {
  const candidates = nodeBinaryCandidates();

  for (const candidate of candidates) {
    if (nodeVersion(candidate)?.startsWith("v24.")) {
      return candidate;
    }
  }

  throw new Error(
    "Node 24 is required. Run this script with Node 24 or set NODE_24_BINARY to a Node 24 executable."
  );
}

function nodeBinaryCandidates() {
  const candidates = new Set();
  if (process.env.NODE_24_BINARY) {
    candidates.add(process.env.NODE_24_BINARY);
  }
  candidates.add(process.execPath);

  for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
    if (directory) {
      candidates.add(path.join(directory, process.platform === "win32" ? "node.exe" : "node"));
    }
  }

  const nvmRoot = process.env.NVM_DIR ?? path.join(homedir(), ".nvm");
  const nvmVersionsRoot = path.join(nvmRoot, "versions", "node");
  try {
    const versions = readdirSync(nvmVersionsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("v24."))
      .map((entry) => entry.name)
      .sort(compareVersionNames)
      .reverse();
    for (const version of versions) {
      candidates.add(path.join(nvmVersionsRoot, version, "bin", "node"));
    }
  } catch {
    // Node 24 may still be available through PATH or NODE_24_BINARY.
  }

  return candidates;
}

function nodeVersion(binary) {
  try {
    accessSync(binary, fsConstants.X_OK);
    if (!statSync(binary).isFile()) {
      return undefined;
    }
  } catch {
    return undefined;
  }

  const result = spawnSync(binary, ["--version"], {
    encoding: "utf8",
    timeout: 2_000
  });
  return result.status === 0 ? result.stdout.trim() : undefined;
}

function compareVersionNames(left, right) {
  const leftParts = left.slice(1).split(".").map(Number);
  const rightParts = right.slice(1).split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

function assertReadableFile(file, message) {
  try {
    accessSync(file, fsConstants.R_OK);
    assert.ok(statSync(file).isFile(), message);
  } catch (error) {
    throw new Error(message, { cause: error });
  }
}
