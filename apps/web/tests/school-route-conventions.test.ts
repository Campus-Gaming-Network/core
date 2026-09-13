import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import test from "node:test";

const currentDirectory = process.cwd();
const appRoot = basename(currentDirectory) === "web"
  ? currentDirectory
  : join(currentDirectory, "apps/web");

function source(relativePath: string) {
  return readFileSync(join(appRoot, relativePath), "utf8");
}

test("home and school routes isolate catalog freshness from viewer state", () => {
  const home = source("src/routes/index.tsx");
  const schools = source("src/routes/schools.index.tsx");
  const school = source("src/routes/schools.$slug.tsx");

  assert.match(home, /staleTime: catalogClientStaleTime/);
  assert.match(schools, /loaderDeps: \(\{ search \}\) => schoolsBrowseInput\(search\)/);
  assert.match(schools, /staleTime: catalogClientStaleTime/);
  assert.match(school, /staleTime: 0/);
  assert.match(school, /"cache-control": "private, no-store"/);
  assert.match(school, /vary: "Cookie"/);
  assert.match(school, /throw notFound\(\)/);
});

test("registered school destinations use typed links and expose follow actions", () => {
  const home = source("src/routes/index.tsx");
  const root = source("src/routes/__root.tsx");
  const browse = source("src/routes/schools.index.tsx");
  const detail = source("src/routes/schools.$slug.tsx");
  const routeNames = readdirSync(join(appRoot, "src/routes"));

  assert.match(root, /<Link to="\/schools">Schools<\/Link>/);
  assert.match(home, /to="\/schools\/\$slug"/);
  assert.match(browse, /to="\/schools\/\$slug"/);
  assert.doesNotMatch(home, /href=\{`\/schools\//);
  assert.doesNotMatch(browse, /href=\{`\/schools\//);
  assert.match(detail, /action=\{action\}/);
  assert.match(detail, /method="post"/);
  assert.match(detail, /useServerFn\(followSchool\)/);
  assert.match(detail, /useServerFn\(unfollowSchool\)/);
  assert.match(detail, /useEnhancedMutation/);
  assert.match(detail, /name="school_id"/);
  assert.match(detail, /name="slug"/);
  assert.match(detail, /to="\/login"/);
  assert.match(detail, /search=\{\{ next: `\/schools\/\$\{school\.slug\}` \}\}/);
  assert.doesNotMatch(detail, /controls are coming in the next migration phase/);
  assert.equal(routeNames.includes("schools.$slug.tsx"), true);
  assert.equal(routeNames.some((name) => name.includes("\\")), false);
});

test("follow server functions keep credentials server-side and native redirects bounded", () => {
  const functions = source(
    "src/features/school-slice/school-follow.functions.ts"
  );
  const operations = source(
    "src/features/school-slice/school-follow-operations.server.ts"
  );

  assert.equal((functions.match(/method: "POST"/g) ?? []).length, 2);
  assert.equal(
    (functions.match(/strict: \{ input: false \}/g) ?? []).length,
    2
  );
  assert.match(functions, /validateSchoolFollowServerInput/);
  assert.match(functions, /currentSessionRequest\(\)/);
  assert.match(functions, /setPrivateNoStoreResponse\(\)/);
  assert.match(functions, /isNativeFormPost\(\)/);
  assert.match(functions, /statusCode: 303/);
  assert.match(functions, /"\/schools\?follow=failed"/);
  assert.doesNotMatch(functions, /cookieHeader.*data/);
  assert.doesNotMatch(functions, /user_id|viewer/);

  assert.match(operations, /method: "POST" \| "DELETE"/);
  assert.match(operations, /cookieHeader/);
  assert.match(operations, /responseSchema: emptyResponseDtoSchema/);
  assert.match(operations, /error instanceof ApiError && error\.status === 401/);
  assert.match(operations, /encodeURIComponent\(next\)/);
  assert.doesNotMatch(operations, /body:/);
});

test("school API route exposes GET and HEAD with an explicit 405 boundary", () => {
  const apiRoute = source("src/routes/api.schools.ts");

  assert.match(apiRoute, /GET: \(\{ request \}\) => handleSchoolsRequest\(request\)/);
  assert.match(apiRoute, /HEAD: \(\{ request \}\) => handleSchoolsRequest\(request\)/);
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
    assert.match(apiRoute, new RegExp(`${method}: schoolsMethodNotAllowedResponse`));
  }
});
