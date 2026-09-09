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
  source: "tanstack-start-production-smoke"
};
const eventSlug = "private-smoke-event";
const missingEventSlug = "missing-smoke-event";
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
const webStartRoot = path.join(repositoryRoot, "apps", "web-start");
const launcherPath = path.join(
  webStartRoot,
  "src",
  "production-preflight.ts"
);
const outputEntryPath = path.join(
  webStartRoot,
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
    "Production launcher is missing; expected apps/web-start/src/production-preflight.ts"
  );
  assertReadableFile(
    outputEntryPath,
    "Production output is missing; build apps/web-start before running this smoke test"
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
      cwd: webStartRoot,
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
  await verifyHomePage(webOrigin, overallController.signal);
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

  process.stdout.write(
    `PASS TanStack Start production HTTP smoke (${nodeVersion(nodeBinary)})\n`
  );
  process.stdout.write(`  GET /: 200 SSR shell and title\n`);
  process.stdout.write(`  GET /api/health: 200 exact healthy envelope\n`);
  process.stdout.write(`  POST /api/health: 405 Allow: GET, HEAD\n`);
  process.stdout.write(`  /api/navigation-session: anonymous/authenticated no-store + POST 405\n`);
  process.stdout.write(`  GET unknown route: 404 noindex shell\n`);
  process.stdout.write(`  GET locked/missing events: private 200 shell and true 404\n`);
  process.stdout.write(`  Cross-origin native form POST: rejected before upstream\n`);
  process.stdout.write(`  Native login/unlock/RSVP forms: 303 redirects, cookies, upstream calls\n`);
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

async function verifyHomePage(origin, overallSignal) {
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
    /<h1[^>]*>Campus Gaming Network on TanStack Start<\/h1>/i,
    "GET / SSR output must include the migration home heading"
  );
  assert.match(
    html,
    new RegExp(
      `<meta\\s+property="og:url"\\s+content="${escapeRegularExpression(origin)}"\\s*\\/?>`,
      "i"
    ),
    "GET / must emit an absolute Open Graph URL from SITE_URL"
  );
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
      api: fakeAPIHealthPayload
    },
    "GET /api/health must return the exact web envelope and fake API payload"
  );
}

async function verifyHealthMethodBoundary(origin, overallSignal) {
  const response = await smokeFetch(
    `${origin}/api/health`,
    { method: "POST" },
    overallSignal
  );
  assert.equal(response.status, 405, "POST /api/health must return HTTP 405");
  assert.equal(
    response.headers.get("allow"),
    "GET, HEAD",
    "POST /api/health must advertise exactly Allow: GET, HEAD"
  );
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

  const postResponse = await smokeFetch(
    `${origin}/api/navigation-session`,
    { method: "POST", redirect: "manual" },
    overallSignal
  );
  assert.equal(
    postResponse.status,
    405,
    "POST /api/navigation-session must return HTTP 405"
  );
  assert.equal(
    postResponse.headers.get("allow"),
    "GET, HEAD",
    "POST /api/navigation-session must advertise exactly Allow: GET, HEAD"
  );
  await postResponse.body?.cancel();
}

async function verifyNotFoundPage(origin, overallSignal) {
  const response = await smokeFetch(
    `${origin}/__tanstack_start_smoke_missing__`,
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
    cookie: headerValue(request.headers.cookie),
    eventUnlock: headerValue(request.headers["x-cgn-event-unlock"]),
    body
  };
  calls.push(call);

  if ((method === "GET" || method === "HEAD") && requestURL.pathname === "/health") {
    writeJSON(response, 200, fakeAPIHealthPayload, { head: method === "HEAD" });
    return;
  }

  if (method === "GET" && requestURL.pathname === `/events/${missingEventSlug}`) {
    writeJSON(response, 404, { error: "event_not_found" });
    return;
  }

  if (method === "GET" && requestURL.pathname === `/events/${eventSlug}`) {
    if (call.eventUnlock === unlockToken) {
      writeJSON(response, 200, visibleEvent());
    } else {
      writeJSON(response, 200, {
        slug: eventSlug,
        visibility: "private",
        locked: true
      });
    }
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

function visibleEvent({ viewerRSVP } = {}) {
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
    ...(viewerRSVP === "yes" || viewerRSVP === "maybe" || viewerRSVP === "no"
      ? { viewer_rsvp: viewerRSVP }
      : {})
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
    role_indicators: []
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
