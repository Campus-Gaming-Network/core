#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  accessSync,
  constants as fsConstants,
  readdirSync,
  statSync
} from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { Agent as HTTPAgent } from "node:http";
import { createServer as createNetServer } from "node:net";
import { homedir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { chromium } from "@playwright/test";

const warmupRequests = positiveInteger(process.env.PERF_WARMUPS, 5);
const measuredRequests = positiveInteger(process.env.PERF_SAMPLES, 20);
const upstreamDelayMilliseconds = positiveInteger(
  process.env.PERF_UPSTREAM_DELAY_MS,
  8
);
const requestTimeoutMilliseconds = 5_000;
const startupTimeoutMilliseconds = 15_000;
const shutdownTimeoutMilliseconds = 3_000;
const maximumChildOutputBytes = 32 * 1024;
const nextBuildBundler = process.env.NEXT_BUILD_BUNDLER ?? "unverified";
const cases = [
  {
    name: "public",
    pathname: "/events/public-performance-event",
    heading: "Performance Fixture Event"
  },
  {
    name: "locked",
    pathname: "/events/locked-performance-event",
    heading: "This event is private."
  }
];

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const nextRoot = path.join(repositoryRoot, "apps", "web");
const startRoot = path.join(repositoryRoot, "apps", "web-start");
const nextEntry = path.join(
  repositoryRoot,
  "node_modules",
  "next",
  "dist",
  "bin",
  "next"
);
const nextBuildID = path.join(nextRoot, ".next", "BUILD_ID");
const startLauncher = path.join(startRoot, "src", "production-preflight.ts");
const startEntry = path.join(startRoot, ".output", "server", "index.mjs");

let fakeAPI;
let nextProcess;
let startProcess;
let nextOutput;
let startOutput;
let browser;
const agents = [];

try {
  assert.match(
    process.version,
    /^v24\./,
    "Run the performance harness itself with Node 24 so gzip measurements use the pinned runtime"
  );
  assertReadableFile(nextEntry, "Next.js executable is missing");
  assertReadableFile(nextBuildID, "Next production output is missing; run its build first");
  assertReadableFile(startLauncher, "TanStack Start production launcher is missing");
  assertReadableFile(startEntry, "TanStack Start production output is missing; run its build first");

  const nodeBinary = findNode24Binary();
  fakeAPI = await startFakeAPI();
  const [nextPort, startPort] = await Promise.all([
    findAvailablePort(),
    findAvailablePort()
  ]);
  assert.notEqual(nextPort, startPort, "Benchmark servers must use distinct ports");

  const nextOrigin = `http://127.0.0.1:${nextPort}`;
  const startOrigin = `http://127.0.0.1:${startPort}`;

  nextProcess = spawn(
    nodeBinary,
    [nextEntry, "start", "--hostname", "127.0.0.1", "--port", String(nextPort)],
    {
      cwd: nextRoot,
      env: applicationEnvironment(fakeAPI.origin, nextOrigin),
      stdio: ["ignore", "pipe", "pipe"]
    }
  );
  nextOutput = captureChildOutput(nextProcess);

  startProcess = spawn(nodeBinary, ["src/production-preflight.ts"], {
    cwd: startRoot,
    env: {
      ...applicationEnvironment(fakeAPI.origin, startOrigin),
      SITE_URL: startOrigin,
      HOST: "127.0.0.1",
      NITRO_HOST: "127.0.0.1",
      PORT: String(startPort)
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  startOutput = captureChildOutput(startProcess);

  await Promise.all([
    waitForServer(nextOrigin, nextProcess, nextOutput),
    waitForServer(startOrigin, startProcess, startOutput)
  ]);

  const frameworks = [
    {
      name: "Next.js 16.3.0",
      origin: nextOrigin,
      agent: trackedAgent()
    },
    {
      name: "TanStack Start 1.168.50",
      origin: startOrigin,
      agent: trackedAgent()
    }
  ];
  const results = [];

  for (const benchmarkCase of cases) {
    for (let index = 0; index < warmupRequests; index += 1) {
      for (const framework of orderedFrameworks(frameworks, index)) {
        await fetchDocument(framework, benchmarkCase, `warmup-${index}`);
      }
    }

    const measurements = new Map(
      frameworks.map((framework) => [framework.name, []])
    );

    for (let index = 0; index < measuredRequests; index += 1) {
      for (const framework of orderedFrameworks(frameworks, index)) {
        const callStart = fakeAPI.calls.length;
        const measurement = await fetchDocument(
          framework,
          benchmarkCase,
          `sample-${index}`
        );
        const calls = fakeAPI.calls.slice(callStart);
        measurement.upstreamEventCalls = calls.filter(
          (call) => call.pathname === benchmarkCase.pathname
        ).length;
        measurement.upstreamViewerCalls = calls.filter(
          (call) => call.pathname === "/me"
        ).length;
        measurements.get(framework.name).push(measurement);
      }
    }

    for (const framework of frameworks) {
      results.push({
        framework: framework.name,
        case: benchmarkCase.name,
        ...summarizeMeasurements(measurements.get(framework.name))
      });
    }
  }

  browser = await chromium.launch({ headless: true });
  for (const result of results) {
    const framework = frameworks.find(({ name }) => name === result.framework);
    const benchmarkCase = cases.find(({ name }) => name === result.case);
    result.browserJavaScript = await measureBrowserJavaScript(
      browser,
      framework,
      benchmarkCase
    );
  }

  process.stdout.write(
    `${JSON.stringify(
      {
        node: process.version,
        serverNode: nodeVersion(nodeBinary),
        nextBuildBundler,
        warmupRequests,
        measuredRequests,
        upstreamDelayMilliseconds,
        results,
        limitations: [
          "Loopback timing is a controlled diagnostic, not production latency.",
          "The measurement covers one representative event route, not the full application workload.",
          "Offline gzip is calculated per response or JavaScript resource; it is not an observed CDN transfer size.",
          "Hydration CPU is not reported because RSC and Start do not expose one equivalent hydration-complete mark in these applications."
        ]
      },
      null,
      2
    )}\n`
  );
} catch (error) {
  process.stderr.write(
    `FAIL production event-route performance comparison\n${formatError(error)}\n`
  );
  if (nextOutput) {
    process.stderr.write(nextOutput.format("Next.js"));
  }
  if (startOutput) {
    process.stderr.write(startOutput.format("TanStack Start"));
  }
  process.exitCode = 1;
} finally {
  for (const agent of agents) {
    agent.destroy();
  }
  await browser?.close();
  await terminateChild(nextProcess);
  await terminateChild(startProcess);
  await closeServer(fakeAPI?.server);
}

function applicationEnvironment(apiOrigin, siteOrigin) {
  return {
    ...process.env,
    NODE_ENV: "production",
    DEPLOYMENT_ENV: "local",
    NEXT_TELEMETRY_DISABLED: "1",
    API_INTERNAL_URL: apiOrigin,
    API_SESSION_COOKIE: "cgn_session",
    API_PROXY_SHARED_SECRET: "local-performance-proxy-secret-not-for-production",
    CLOUDFLARE_ORIGIN_SECRET:
      "local-performance-cloudflare-secret-not-for-production",
    NEXT_PUBLIC_SITE_URL: siteOrigin
  };
}

function trackedAgent() {
  const agent = new HTTPAgent({ keepAlive: true, maxSockets: 1 });
  agents.push(agent);
  return agent;
}

function orderedFrameworks(frameworks, index) {
  return index % 2 === 0 ? frameworks : frameworks.toReversed();
}

async function fetchDocument(framework, benchmarkCase, run) {
  const url = new URL(benchmarkCase.pathname, framework.origin);
  url.searchParams.set("performance_run", run);
  const response = await requestDocument(url, framework.agent);

  assert.equal(
    response.status,
    200,
    `${framework.name} ${benchmarkCase.name} route must return HTTP 200`
  );
  assert.match(
    response.headers["content-type"] ?? "",
    /^text\/html\b/i,
    `${framework.name} ${benchmarkCase.name} route must return HTML`
  );
  assert.ok(
    response.body.includes(benchmarkCase.heading),
    `${framework.name} ${benchmarkCase.name} response must contain its expected heading`
  );

  const inline = inlineScriptBytes(response.body);
  return {
    ttfbMilliseconds: response.ttfbMilliseconds,
    totalMilliseconds: response.totalMilliseconds,
    documentBytes: Buffer.byteLength(response.body),
    documentGzipBytes: gzipSync(response.body).length,
    inlineScriptBytes: inline.raw,
    inlineScriptGzipBytes: inline.gzip
  };
}

function requestDocument(url, agent) {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const request = httpRequest(
      url,
      {
        agent,
        headers: {
          accept: "text/html",
          "accept-encoding": "identity",
          "cache-control": "no-cache"
        }
      },
      (response) => {
        const ttfbMilliseconds = performance.now() - started;
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks).toString("utf8"),
            ttfbMilliseconds,
            totalMilliseconds: performance.now() - started
          });
        });
      }
    );

    request.setTimeout(requestTimeoutMilliseconds, () => {
      request.destroy(new Error(`Timed out requesting ${url}`));
    });
    request.once("error", reject);
    request.end();
  });
}

function inlineScriptBytes(html) {
  const bodies = [];
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (!/\bsrc\s*=/i.test(match[1])) {
      bodies.push(match[2]);
    }
  }
  const combined = Buffer.from(bodies.join(""));
  return {
    raw: combined.length,
    gzip: combined.length === 0 ? 0 : gzipSync(combined).length
  };
}

function summarizeMeasurements(measurements) {
  return {
    ttfbMilliseconds: summarize(measurements.map((value) => value.ttfbMilliseconds)),
    totalMilliseconds: summarize(measurements.map((value) => value.totalMilliseconds)),
    documentBytes: summarize(measurements.map((value) => value.documentBytes)),
    documentGzipBytes: summarize(
      measurements.map((value) => value.documentGzipBytes)
    ),
    inlineScriptBytes: summarize(
      measurements.map((value) => value.inlineScriptBytes)
    ),
    inlineScriptGzipBytes: summarize(
      measurements.map((value) => value.inlineScriptGzipBytes)
    ),
    upstreamEventCalls: uniqueValue(
      measurements.map((value) => value.upstreamEventCalls),
      "event calls"
    ),
    upstreamViewerCalls: uniqueValue(
      measurements.map((value) => value.upstreamViewerCalls),
      "viewer calls"
    )
  };
}

function summarize(values) {
  const sorted = values.toSorted((left, right) => left - right);
  return {
    median: round(percentile(sorted, 0.5)),
    p95: round(percentile(sorted, 0.95))
  };
}

function percentile(sortedValues, fraction) {
  const index = Math.max(0, Math.ceil(sortedValues.length * fraction) - 1);
  return sortedValues[index];
}

function uniqueValue(values, label) {
  const unique = new Set(values);
  assert.equal(unique.size, 1, `Expected a stable number of upstream ${label}`);
  return values[0];
}

async function measureBrowserJavaScript(browserInstance, framework, benchmarkCase) {
  const context = await browserInstance.newContext();
  const page = await context.newPage();
  const bodies = new Map();
  const pendingBodies = [];

  page.on("response", (response) => {
    const responseURL = new URL(response.url());
    if (
      responseURL.origin !== framework.origin ||
      !responseURL.pathname.endsWith(".js")
    ) {
      return;
    }
    const pending = response.body().then((body) => bodies.set(response.url(), body));
    pendingBodies.push(pending);
  });

  try {
    const response = await page.goto(
      `${framework.origin}${benchmarkCase.pathname}?performance_run=browser`,
      { waitUntil: "load", timeout: startupTimeoutMilliseconds }
    );
    assert.equal(response?.status(), 200, "Browser route navigation must return 200");
    await page.waitForLoadState("networkidle");
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    );
    await Promise.all(pendingBodies);
    await page.getByRole("heading", { name: benchmarkCase.heading }).waitFor();

    return {
      resources: bodies.size,
      rawBytes: Array.from(bodies.values()).reduce(
        (total, body) => total + body.length,
        0
      ),
      gzipBytes: Array.from(bodies.values()).reduce(
        (total, body) => total + gzipSync(body).length,
        0
      )
    };
  } finally {
    await context.close();
  }
}

async function startFakeAPI() {
  const calls = [];
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://fake-api.local");
    calls.push({ method: request.method ?? "GET", pathname: url.pathname });
    await delay(upstreamDelayMilliseconds);

    if (request.method === "GET" && url.pathname === "/health") {
      writeJSON(response, 200, { service: "performance-fixture", status: "ok" });
      return;
    }
    if (request.method === "GET" && url.pathname === "/me") {
      writeJSON(response, 401, { error: "authentication_required" });
      return;
    }
    if (
      request.method === "GET" &&
      url.pathname === "/events/locked-performance-event"
    ) {
      writeJSON(response, 200, {
        slug: "locked-performance-event",
        visibility: "private",
        locked: true
      });
      return;
    }
    if (
      request.method === "GET" &&
      url.pathname === "/events/public-performance-event"
    ) {
      writeJSON(response, 200, publicEvent());
      return;
    }

    writeJSON(response, 404, { error: "not_found" });
  });
  const port = await listenOnEphemeralPort(server);
  return { server, calls, origin: `http://127.0.0.1:${port}` };
}

function publicEvent() {
  return {
    id: "event-performance",
    title: "Performance Fixture Event",
    slug: "public-performance-event",
    description: "A deterministic public event used for production comparisons.",
    visibility: "public",
    format: "in_person",
    starts_at: "2037-08-15T17:00:00Z",
    ends_at: "2037-08-15T19:00:00Z",
    timezone: "America/Los_Angeles",
    location_name: "Student Union",
    address: "100 Campus Way",
    capacity: 24,
    rsvp_yes_count: 7,
    interest_count: 11,
    lifecycle: "upcoming",
    is_paid: false,
    host_school: {
      id: "school-performance",
      name: "Performance University",
      slug: "performance-university",
      city: "Irvine",
      state: "CA"
    },
    games: [
      { id: "game-performance", name: "Performance Arena", slug: "performance-arena" }
    ],
    organizers: [
      {
        id: "user-performance",
        name: "Performance Organizer",
        role: "creator",
        verification_level: "verified_student"
      }
    ]
  };
}

function writeJSON(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body)
  });
  response.end(body);
}

async function waitForServer(origin, child, output) {
  const deadline = performance.now() + startupTimeoutMilliseconds;
  while (performance.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Server exited before readiness\n${output.format("server")}`);
    }
    try {
      const response = await fetch(`${origin}${cases[0].pathname}`, {
        signal: AbortSignal.timeout(requestTimeoutMilliseconds)
      });
      if (response.status === 200) {
        await response.body?.cancel();
        return;
      }
    } catch {
      // The production process may still be binding its socket.
    }
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${origin}`);
}

async function findAvailablePort() {
  const server = createNetServer();
  const port = await listenOnEphemeralPort(server);
  await closeServer(server);
  return port;
}

function listenOnEphemeralPort(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Unable to determine ephemeral port"));
      } else {
        resolve(address.port);
      }
    });
  });
}

function captureChildOutput(child) {
  const state = { stdout: "", stderr: "", spawnError: undefined };
  child.stdout?.on("data", (chunk) => {
    state.stdout = appendBounded(state.stdout, chunk);
  });
  child.stderr?.on("data", (chunk) => {
    state.stderr = appendBounded(state.stderr, chunk);
  });
  child.once("error", (error) => {
    state.spawnError = error;
  });
  state.format = (label) =>
    `--- ${label} stdout ---\n${state.stdout || "(empty)\n"}` +
    `--- ${label} stderr ---\n${state.stderr || "(empty)\n"}`;
  return state;
}

function appendBounded(current, chunk) {
  return Buffer.from(current + String(chunk))
    .subarray(-maximumChildOutputBytes)
    .toString();
}

async function terminateChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  child.kill("SIGTERM");
  const exited = await Promise.race([
    new Promise((resolve) => child.once("exit", () => resolve(true))),
    delay(shutdownTimeoutMilliseconds).then(() => false)
  ]);
  if (!exited && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
  }
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

function assertReadableFile(filePath, message) {
  try {
    accessSync(filePath, fsConstants.R_OK);
    assert.ok(statSync(filePath).isFile(), message);
  } catch {
    throw new Error(`${message}: ${filePath}`);
  }
}

function findNode24Binary() {
  for (const candidate of nodeBinaryCandidates()) {
    if (nodeVersion(candidate)?.startsWith("v24.")) {
      return candidate;
    }
  }
  throw new Error(
    "Node 24 is required. Run with Node 24 or set NODE_24_BINARY to its executable."
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
  const versionsRoot = path.join(nvmRoot, "versions", "node");
  try {
    for (const entry of readdirSync(versionsRoot, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.startsWith("v24.")) {
        candidates.add(path.join(versionsRoot, entry.name, "bin", "node"));
      }
    }
  } catch {
    // Node 24 may still be available through PATH or NODE_24_BINARY.
  }
  return candidates;
}

function nodeVersion(binary) {
  try {
    accessSync(binary, fsConstants.X_OK);
  } catch {
    return undefined;
  }
  const result = spawnSync(binary, ["--version"], {
    encoding: "utf8",
    timeout: 2_000
  });
  return result.status === 0 ? result.stdout.trim() : undefined;
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function formatError(error) {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}
