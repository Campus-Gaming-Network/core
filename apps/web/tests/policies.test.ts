import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import test from "node:test";
import { policyDocument, validatePolicySearch } from "../src/policies/index.js";

const currentDirectory = process.cwd();
const repositoryRoot =
  basename(currentDirectory) === "web"
    ? join(currentDirectory, "../..")
    : currentDirectory;

test("each published policy file still has the hash its migration recorded", () => {
  const migration = readFileSync(
    join(repositoryRoot, "db/migrations/000019_policy_acceptance.up.sql"),
    "utf8",
  );
  const recorded = [
    ...migration.matchAll(
      /\('(terms|privacy)', '([^']+)', '[^']+',\s+'([0-9a-f]{64})',\s+'([^']+)'\)/g,
    ),
  ].map(([, type, version, hash, sourceRef]) => ({
    type,
    version,
    hash,
    sourceRef,
  }));

  assert.deepEqual(
    recorded.map(({ type, version, sourceRef }) => ({
      type,
      version,
      sourceRef,
      hash: createHash("sha256")
        .update(readFileSync(join(repositoryRoot, sourceRef)))
        .digest("hex"),
      served: policyDocument(type as "terms" | "privacy", version)?.version,
    })),
    recorded.map(({ type, version, sourceRef, hash }) => ({
      type,
      version,
      sourceRef,
      hash,
      served: version,
    })),
  );
  assert.equal(recorded.length, 2);
});

test("a policy page serves its latest version, a named published one, and nothing else", () => {
  assert.equal(policyDocument("terms")?.version, "draft-2026-10-06");
  assert.equal(policyDocument("privacy", "draft-2026-10-06")?.type, "privacy");
  assert.equal(policyDocument("terms", "never-published"), undefined);

  assert.deepEqual(validatePolicySearch({ version: "draft-2026-10-06" }), {
    version: "draft-2026-10-06",
  });
  for (const version of [undefined, "", "../etc/passwd", "A", 7, ["x y"]]) {
    assert.deepEqual(validatePolicySearch({ version }), {});
  }
});
