#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const maximumCapturedBytes = 128 * 1024;
const buildTimeoutMilliseconds = 10 * 60 * 1000;
const commandTimeoutMilliseconds = 30 * 1000;
const startupTimeoutMilliseconds = 30 * 1000;
const shutdownGraceMilliseconds = 2 * 1000;

const runIdentity = [
  process.env.GITHUB_RUN_ID,
  process.env.GITHUB_RUN_ATTEMPT,
  process.pid
]
  .filter(Boolean)
  .join("-")
  .toLowerCase()
  .replace(/[^a-z0-9_.-]/g, "-");
const imageTag = `cgn-web-start-ci:${runIdentity}`;
const containerName = `cgn-web-start-ci-${runIdentity}`;

const expectedHealthBody = {
  service: "campus-gaming-network-web",
  status: "degraded",
  reason: "api_unreachable"
};

let activeChild;
let cleanupPromise;

async function main() {
  process.stdout.write("Building the TanStack Start production runner image...\n");
  await runDocker(
    [
      "build",
      "--target",
      "runner",
      "--file",
      "apps/web-start/Dockerfile",
      "--tag",
      imageTag,
      "."
    ],
    { timeoutMilliseconds: buildTimeoutMilliseconds, streamOutput: true }
  );

  process.stdout.write("Starting the isolated production container...\n");
  await runDocker([
    "run",
    "--detach",
    "--name",
    containerName,
    "--network",
    "none",
    "--health-cmd",
    "node -e 'fetch(\"http://127.0.0.1:3000/api/health\").then((response) => process.exit(response.status === 503 ? 0 : 1)).catch(() => process.exit(1))'",
    "--health-interval",
    "1s",
    "--health-timeout",
    "3s",
    "--health-retries",
    "20",
    "--health-start-period",
    "2s",
    "--env",
    "DEPLOYMENT_ENV=production",
    "--env",
    "API_INTERNAL_URL=http://api.railway.internal:9",
    "--env",
    "API_SESSION_COOKIE=cgn_session",
    "--env",
    "API_PROXY_SHARED_SECRET=0123456789abcdef0123456789abcdef",
    "--env",
    "CLOUDFLARE_ORIGIN_SECRET=abcdef0123456789abcdef0123456789",
    "--env",
    "SITE_URL=https://web-start-ci.invalid",
    "--env",
    "HOST=0.0.0.0",
    "--env",
    "PORT=3000",
    imageTag
  ]);

  await waitForHealthyContainer();
  await verifyRuntimeIdentity();
  await verifyUnavailableAPIResponse();

  process.stdout.write(
    "TanStack Start production Docker gate passed: healthy runner, uid/gid 1000, expected API-unavailable 503.\n"
  );
}

async function waitForHealthyContainer() {
  const deadline = Date.now() + startupTimeoutMilliseconds;
  let lastStatus = "unknown";

  while (Date.now() < deadline) {
    const result = await runDocker([
      "inspect",
      "--format",
      "{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}",
      containerName
    ]);
    lastStatus = result.stdout.trim();

    if (lastStatus === "healthy") {
      return;
    }
    if (lastStatus === "unhealthy") {
      break;
    }
    await delay(500);
  }

  const logs = await runDocker(["logs", "--tail", "80", containerName], {
    check: false
  });
  throw new Error(
    `container did not become healthy within ${startupTimeoutMilliseconds}ms (last status: ${lastStatus})\n${logs.stdout}${logs.stderr}`
  );
}

async function verifyRuntimeIdentity() {
  const configuredUser = await runDocker([
    "inspect",
    "--format",
    "{{.Config.User}}",
    containerName
  ]);
  assert.equal(
    configuredUser.stdout.trim(),
    "node",
    "production runner must configure the non-root node user"
  );

  const identity = await runDocker([
    "exec",
    containerName,
    "node",
    "--eval",
    "process.stdout.write(JSON.stringify({uid:process.getuid?.(),gid:process.getgid?.()}))"
  ]);
  assert.deepEqual(
    JSON.parse(identity.stdout),
    { uid: 1000, gid: 1000 },
    "production runner must execute with the node image's uid/gid 1000"
  );
}

async function verifyUnavailableAPIResponse() {
  const probe = await runDocker([
    "exec",
    containerName,
    "node",
    "--input-type=module",
    "--eval",
    [
      'const response = await fetch("http://127.0.0.1:3000/api/health");',
      "const body = await response.json();",
      "process.stdout.write(JSON.stringify({status:response.status,contentType:response.headers.get(\"content-type\"),body}));"
    ].join("")
  ]);
  const result = JSON.parse(probe.stdout);

  assert.equal(
    result.status,
    503,
    "direct /api/health probe must return 503 while the API is deliberately unavailable"
  );
  assert.match(
    result.contentType ?? "",
    /^application\/json\b/i,
    "direct /api/health probe must return JSON"
  );
  assert.deepEqual(
    result.body,
    expectedHealthBody,
    "direct /api/health probe must return the safe degraded envelope"
  );
}

function runDocker(
  arguments_,
  {
    check = true,
    streamOutput = false,
    timeoutMilliseconds = commandTimeoutMilliseconds
  } = {}
) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", arguments_, {
      cwd: repoRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    activeChild = child;

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let forceKillTimer;

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      forceKillTimer = setTimeout(
        () => child.kill("SIGKILL"),
        shutdownGraceMilliseconds
      );
      forceKillTimer.unref();
    }, timeoutMilliseconds);
    timeout.unref();

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout = appendBounded(stdout, text);
      if (streamOutput) process.stdout.write(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr = appendBounded(stderr, text);
      if (streamOutput) process.stderr.write(text);
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      if (activeChild === child) activeChild = undefined;
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      if (activeChild === child) activeChild = undefined;

      const result = { code, signal, stdout, stderr };
      if (!check || code === 0) {
        resolve(result);
        return;
      }

      const cause = timedOut
        ? `timed out after ${timeoutMilliseconds}ms`
        : `exited with code ${code}${signal ? ` (signal ${signal})` : ""}`;
      reject(
        new Error(
          `docker ${arguments_.join(" ")} ${cause}\n${stdout}${stderr}`.trimEnd()
        )
      );
    });
  });
}

function appendBounded(current, addition) {
  const combined = current + addition;
  return combined.length <= maximumCapturedBytes
    ? combined
    : combined.slice(-maximumCapturedBytes);
}

function cleanup() {
  if (!cleanupPromise) {
    cleanupPromise = (async () => {
      activeChild?.kill("SIGTERM");
      const containerCleanup = await runDocker(
        ["rm", "--force", containerName],
        { check: false }
      );
      const imageCleanup = await runDocker(["image", "rm", "--force", imageTag], {
        check: false
      });
      for (const result of [containerCleanup, imageCleanup]) {
        if (result.code !== 0 && !/No such (container|image)/i.test(result.stderr)) {
          process.stderr.write(`Docker cleanup warning: ${result.stderr}`);
        }
      }
    })();
  }
  return cleanupPromise;
}

for (const [signal, exitCode] of [
  ["SIGINT", 130],
  ["SIGTERM", 143]
]) {
  process.once(signal, () => {
    void cleanup().finally(() => process.exit(exitCode));
  });
}

let failure;
try {
  await main();
} catch (error) {
  failure = error;
} finally {
  await cleanup();
}

if (failure) {
  process.stderr.write(
    `TanStack Start production Docker gate failed: ${failure instanceof Error ? failure.message : String(failure)}\n`
  );
  process.exitCode = 1;
}
