import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import test from "node:test";

const currentDirectory = process.cwd();
const appRoot =
  basename(currentDirectory) === "web"
    ? currentDirectory
    : join(currentDirectory, "apps/web");
const source = readFileSync(join(appRoot, "src/routes/account.tsx"), "utf8");

test("account route is private, noindex, strict, and uses typed registered links", () => {
  assert.match(source, /createFileRoute\("\/account"\)/);
  assert.match(source, /private, no-store/);
  assert.match(source, /accountHead\(loaderData\?\.publicOrigin\)/);
  assert.match(source, /getAccountDashboard\(\)/);
  assert.match(source, /dashboard\.status === "unauthenticated"/);
  assert.match(source, /to="\/users\/\$id"/);
  assert.match(source, /to="\/events\/\$slug"/);
  assert.match(source, /to="\/teams\/\$slug"/);
  assert.match(source, /<RoutePending message="Loading your account…"/);
});
