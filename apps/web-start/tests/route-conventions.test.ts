import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import test from "node:test";

const currentDirectory = process.cwd();
const appRoot =
  basename(currentDirectory) === "web-start"
    ? currentDirectory
    : join(currentDirectory, "apps/web-start");

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
    "Error retry must invalidate stale loader data before resetting the boundary"
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

test("registered internal destinations use typed links without inventing routes", () => {
  const event = source("src/routes/events.$slug.tsx");
  const home = source("src/routes/index.tsx");
  const root = source("src/routes/__root.tsx");
  const routeTree = source("src/routeTree.gen.ts");

  assert.match(event, /<Link[\s\S]*?to="\/login"[\s\S]*?search=\{\{/);
  assert.doesNotMatch(event, /href=\{`\/login\?next=/);
  assert.match(root, /router\.navigate\(\{ to: "\/", replace: true \}\)/);
  assert.match(home, /getHomeCatalog/);
  assert.match(home, /<Link[\s\S]*?to="\/schools"/);
  assert.match(home, /<Link[\s\S]*?to="\/events"/);
  assert.doesNotMatch(home, /<a[\s\S]*?href="\/events">Browse events/);

  for (const route of [
    "'/'",
    "'/about'",
    "'/account'",
    "'/auth/reset-password'",
    "'/auth/verify-email'",
    "'/faq'",
    "'/forgot-password'",
    "'/login'",
    "'/privacy'",
    "'/reset-password'",
    "'/schools'",
    "'/signup'",
    "'/support'",
    "'/terms'",
    "'/api/health'",
    "'/api/navigation-session'",
    "'/api/schools'",
    "'/events'",
    "'/events/$slug'",
    "'/events/$slug/edit'",
    "'/events/new'",
    "'/schools/$slug'",
    "'/teams'",
    "'/teams/$slug'",
    "'/teams/new'",
    "'/users/$id'"
  ]) {
    assert.ok(routeTree.includes(route), `Generated route tree must retain ${route}`);
  }
});
