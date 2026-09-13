#!/usr/bin/env node

import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const appRoot = path.join(repositoryRoot, "apps", "web");
const publicOutput = path.join(appRoot, ".output", "public");
const sourceRoot = path.join(appRoot, "src");

const forbiddenClientMarkers = [
  "API_INTERNAL_URL",
  "API_PROXY_SHARED_SECRET",
  "API_SESSION_COOKIE",
  "CLOUDFLARE_ORIGIN_SECRET",
  "smoke-session-token",
  "smoke-outage-session-token",
  "smoke-private-event-unlock-token",
  "local-smoke-proxy-secret-not-for-production",
  "local-smoke-cloudflare-secret-not-for-production",
  "account-password-hash",
  "account-session-secret"
];

const forbiddenSourcePatterns = [
  { label: "Next.js import", pattern: /(?:from|import)\s*\(?["']next(?:\/[^"']*)?["']/ },
  { label: "Next.js build output reference", pattern: /\.next(?:\/|["'])/ },
  { label: "Next.js server directive", pattern: /^[ \t]*["']use server["'];?/m },
  { label: "legacy public site environment", pattern: /NEXT_PUBLIC_SITE_URL/ }
];

assert.ok(
  existsSync(publicOutput),
  "TanStack Start public output is missing; build apps/web before scanning"
);

const clientFiles = readableFiles(publicOutput);
const clientFindings = [];
for (const file of clientFiles) {
  const content = readFileSync(file, "utf8");
  for (const marker of forbiddenClientMarkers) {
    if (content.includes(marker)) {
      clientFindings.push(`${relative(file)} contains ${marker}`);
    }
  }
}

const sourceFindings = [];
for (const file of readableFiles(sourceRoot)) {
  const content = readFileSync(file, "utf8");
  for (const { label, pattern } of forbiddenSourcePatterns) {
    if (pattern.test(content)) {
      sourceFindings.push(`${relative(file)} contains ${label}`);
    }
  }
}

const findings = [...clientFindings, ...sourceFindings];
if (findings.length > 0) {
  process.stderr.write("Web privacy/static scan failed:\n");
  for (const finding of findings) process.stderr.write(`- ${finding}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Web privacy/static scan passed: ${clientFiles.length} public files contain no server markers and application source contains no Next.js boundary.\n`
  );
}

function readableFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...readableFiles(absolutePath));
    } else if (entry.isFile() && !entry.name.endsWith(".woff2")) {
      files.push(absolutePath);
    }
  }
  return files;
}

function relative(file) {
  return path.relative(repositoryRoot, file);
}
