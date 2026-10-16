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
  // Not-found titles read "<what> | Campus Gaming Network", "Page not found"
  // by default.
  assert.match(boundaries, /title: pageTitle = "Page not found"/);
  assert.match(boundaries, /`\$\{pageTitle\} \| \$\{siteName\}`/);
  assert.match(boundaries, /The link may be broken or out of date/);
  assert.match(boundaries, /property="og:description"/);
  assert.match(boundaries, /name="twitter:description"/);
  assert.match(boundaries, /name="robots" content="noindex,nofollow"/);

  assert.match(router, /defaultPendingComponent: DefaultPending/);
  assert.match(router, /defaultErrorComponent: DefaultError/);
  assert.match(router, /defaultNotFoundComponent: DefaultNotFound/);
  assert.match(root, /pendingComponent: DefaultPending/);
  // The root's error view is the shared one inside the site shell, so a
  // failure at the root keeps the header and footer.
  assert.match(root, /errorComponent: RootError/);
  assert.match(
    root,
    /<SiteShell>\s*<DefaultError \{\.\.\.props\} \/>\s*<\/SiteShell>/,
  );
  assert.match(root, /notFoundComponent: DefaultNotFound/);
  assert.match(root, /shellComponent: RootDocument/);
  assert.match(event, /<RoutePending message="Loading event…"/);
  assert.match(event, /<RouteErrorView/);
});
