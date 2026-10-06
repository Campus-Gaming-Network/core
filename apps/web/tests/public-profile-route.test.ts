import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import test from "node:test";

const currentDirectory = process.cwd();
const appRoot =
  basename(currentDirectory) === "web"
    ? currentDirectory
    : join(currentDirectory, "apps/web");
const routeSource = readFileSync(
  join(appRoot, "src/routes/users.$id.tsx"),
  "utf8",
);

test("profile route has a real 404, safe dynamic head, and viewer-aware caching", () => {
  assert.match(routeSource, /throw notFound\(\)/);
  assert.match(routeSource, /publicProfileMetadata\(/);
  assert.match(routeSource, /content: metadata\.url/);
  assert.match(routeSource, /private, no-store/);
  assert.match(routeSource, /public, max-age=0, must-revalidate/);
  assert.match(routeSource, /vary: "Cookie"/);
  assert.doesNotMatch(routeSource, /profile\.email/);
  assert.doesNotMatch(routeSource, /viewer\.id/);
  assert.doesNotMatch(routeSource, /unlock_token/);
});
