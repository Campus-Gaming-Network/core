#!/usr/bin/env node

import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const migrationsDirectory = fileURLToPath(
  new URL("../db/migrations/", import.meta.url),
);

const namePattern = /^(\d{6})_[a-z0-9_]+\.up\.sql$/;
const problems: string[] = [];
const versions: number[] = [];

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

if (problems.length > 0) {
  console.error(`Migration check failed:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}

console.log(
  `Checked ${versions.length} migrations: contiguous, no duplicates.`,
);
