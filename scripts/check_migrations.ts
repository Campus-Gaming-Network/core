#!/usr/bin/env node

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const migrationsDirectory = fileURLToPath(
  new URL("../db/migrations/", import.meta.url),
);

const namePattern = /^(\d{6})_[a-z0-9_]+\.up\.sql$/;
const problems: string[] = [];
const versions: number[] = [];
const upNames: string[] = [];

for (const name of readdirSync(migrationsDirectory).sort()) {
  if (name === "README.md") {
    continue;
  }
  const match = namePattern.exec(name);
  if (!match) {
    problems.push(
      `${name}: expected NNNNNN_snake_case_name.up.sql (migrations are forward-only)`,
    );
    continue;
  }
  versions.push(Number(match[1]));
  upNames.push(name);
}

versions.sort((a, b) => a - b);
versions.forEach((version, index) => {
  const expected = index + 1;
  if (version === versions[index - 1]) {
    problems.push(`version ${version} is used by more than one migration`);
  } else if (version !== expected && version !== versions[index - 1]) {
    problems.push(
      `version ${version} follows ${versions[index - 1] ?? 0}; expected ${expected}`,
    );
  }
});

const readme = readFileSync(`${migrationsDirectory}README.md`, "utf8");
const undocumented = upNames.filter((name) => !readme.includes(name));
if (undocumented.length > 0) {
  problems.push(
    `not described in db/migrations/README.md: ${undocumented.join(", ")}`,
  );
}

if (problems.length > 0) {
  console.error(`Migration check failed:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}

console.log(
  `Checked ${versions.length} migrations: contiguous, no duplicates, all described in README.md.`,
);
