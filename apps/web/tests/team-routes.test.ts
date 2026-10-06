import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import test from "node:test";

const currentDirectory = process.cwd();
const appRoot =
  basename(currentDirectory) === "web"
    ? currentDirectory
    : join(currentDirectory, "apps/web");
const browseSource = readFileSync(
  join(appRoot, "src/routes/teams.index.tsx"),
  "utf8",
);
const detailSource = readFileSync(
  join(appRoot, "src/routes/teams.$slug.tsx"),
  "utf8",
);
const newSource = readFileSync(
  join(appRoot, "src/routes/teams.new.tsx"),
  "utf8",
);

test("team creation supports auth redirects, native search, enhanced POST, and typed links", () => {
  assert.match(newSource, /to: "\/login"/);
  assert.match(newSource, /search: \{ next: "\/teams\/new" \}/);
  assert.match(newSource, /action="\/teams\/new"/);
  assert.match(newSource, /method="get"/);
  assert.match(newSource, /name="school_q"/);
  assert.match(newSource, /action=\{createTeam\.url\}/);
  assert.match(newSource, /useServerFn\(createTeam\)/);
  assert.match(newSource, /mutation\.execute/);
  assert.match(newSource, /name="game_ids"/);
  assert.match(newSource, /type="password"/);
  assert.match(newSource, /to="\/teams"/);
  assert.match(newSource, /noindex,nofollow|newTeamHead/);
});

test("team pages use cookie-aware response headers and exact pending UI", () => {
  for (const source of [browseSource, detailSource]) {
    assert.match(source, /private, no-store/);
    assert.match(source, /public, max-age=0, must-revalidate/);
    assert.match(source, /vary: "Cookie"/);
  }
  assert.match(browseSource, /Loading teams…/);
  assert.match(detailSource, /Loading team…/);
  assert.match(newSource, /private, no-store/);
  assert.match(newSource, /Loading team form…/);
});
