import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import test from "node:test";

const currentDirectory = process.cwd();
const appRoot =
  basename(currentDirectory) === "web"
    ? currentDirectory
    : join(currentDirectory, "apps/web");

function source(relativePath: string) {
  return readFileSync(join(appRoot, relativePath), "utf8");
}

test("shared route defaults preserve safe pending, error, and not-found conventions", () => {
  const boundaries = source("src/components/route-boundaries.tsx");
  const root = source("src/routes/__root.tsx");
  const router = source("src/router.tsx");
  const event = source("src/routes/events.$slug.tsx");

  assert.match(boundaries, /aria-busy="true"/);
  assert.match(boundaries, /aria-live="polite"/);
  assert.match(boundaries, /await router\.invalidate\(\)/);
  assert.ok(
    boundaries.indexOf("await router.invalidate()") <
      boundaries.indexOf("reset();"),
    "Error retry must invalidate stale loader data before resetting the boundary",
  );
  assert.doesNotMatch(boundaries, /error\.message/);
  assert.match(boundaries, /Page not found \| Campus Gaming Network/);
  assert.match(boundaries, /That page does not exist on Campus Gaming Network/);
  assert.match(boundaries, /property="og:description"/);
  assert.match(boundaries, /name="twitter:description"/);
  assert.match(boundaries, /name="robots" content="noindex,nofollow"/);

  assert.match(router, /defaultPendingComponent: DefaultPending/);
  assert.match(router, /defaultErrorComponent: DefaultError/);
  assert.match(router, /defaultNotFoundComponent: DefaultNotFound/);
  assert.match(root, /pendingComponent: DefaultPending/);
  assert.match(root, /errorComponent: DefaultError/);
  assert.match(root, /notFoundComponent: DefaultNotFound/);
  assert.match(root, /shellComponent: RootDocument/);
  assert.match(event, /<RoutePending message="Loading event…"/);
  assert.match(event, /<RouteErrorView/);
});
