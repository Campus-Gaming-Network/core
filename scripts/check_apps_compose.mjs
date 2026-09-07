#!/usr/bin/env node

import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const applicationsRoot = path.join(repositoryRoot, "apps");

const applicationNames = readdirSync(applicationsRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
  .map((entry) => entry.name)
  .sort();

const composeResult = spawnSync(
  "docker",
  ["compose", "--profile", "*", "config", "--format", "json"],
  {
    cwd: repositoryRoot,
    encoding: "utf8"
  }
);

if (composeResult.error) {
  console.error(`Unable to run Docker Compose: ${composeResult.error.message}`);
  process.exit(1);
}

if (composeResult.status !== 0) {
  console.error(composeResult.stderr.trim() || "Docker Compose validation failed.");
  process.exit(composeResult.status ?? 1);
}

let compose;
try {
  compose = JSON.parse(composeResult.stdout);
} catch (error) {
  console.error(`Docker Compose returned invalid JSON: ${error.message}`);
  process.exit(1);
}

const failures = [];

for (const applicationName of applicationNames) {
  const expectedDockerfile = path.join(
    applicationsRoot,
    applicationName,
    "Dockerfile"
  );

  if (!existsSync(expectedDockerfile)) {
    failures.push(`apps/${applicationName} is missing a Dockerfile`);
  }

  const service = compose.services?.[applicationName];
  if (!service) {
    failures.push(
      `apps/${applicationName} is missing the '${applicationName}' Compose service`
    );
    continue;
  }

  if (!service.build || typeof service.build !== "object") {
    failures.push(
      `Compose service '${applicationName}' must build apps/${applicationName}/Dockerfile`
    );
    continue;
  }

  const buildContext = path.resolve(repositoryRoot, service.build.context);
  const configuredDockerfile = path.resolve(
    buildContext,
    service.build.dockerfile ?? "Dockerfile"
  );

  if (configuredDockerfile !== expectedDockerfile) {
    failures.push(
      `Compose service '${applicationName}' builds ${path.relative(repositoryRoot, configuredDockerfile)}, expected apps/${applicationName}/Dockerfile`
    );
  }
}

if (failures.length > 0) {
  console.error("Application container validation failed:\n");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(
  `Validated Docker Compose coverage for ${applicationNames.length} applications: ${applicationNames.join(", ")}`
);
