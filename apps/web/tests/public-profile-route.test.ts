import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import test from "node:test";
import { publicProfileDtoSchema } from "../src/features/public-profile/contracts.js";

const currentDirectory = process.cwd();
const appRoot =
  basename(currentDirectory) === "web"
    ? currentDirectory
    : join(currentDirectory, "apps/web");
const routeSource = readFileSync(
  join(appRoot, "src/routes/users.$id.tsx"),
  "utf8"
);
const functionSource = readFileSync(
  join(
    appRoot,
    "src/features/public-profile/public-profile.functions.ts"
  ),
  "utf8"
);

test("public-profile DTO strips account, session, unlock, and internal-header fields", () => {
  const parsed = publicProfileDtoSchema.parse({
    id: "user-1",
    name: "Player One",
    verification_level: "verified",
    home_school_id: "school-1",
    email: "private@example.test",
    timezone: "America/Los_Angeles",
    session: "server-only-session",
    unlock_token: "server-only-unlock",
    "X-CGN-Visitor-IP": "203.0.113.10",
    "X-CGN-Proxy-Secret": "server-only-secret"
  });

  assert.deepEqual(parsed, {
    id: "user-1",
    name: "Player One",
    verification_level: "verified",
    home_school_id: "school-1"
  });
});

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

test("profile UI renders public verification and viewer-safe report controls", () => {
  assert.match(routeSource, /verificationLabel\(profile\.verification_level\)/);
  assert.match(routeSource, /roleIndicatorLabel/);
  assert.match(routeSource, /to="\/schools\/\$slug"/);
  assert.match(routeSource, /params=\{\{ slug: profile\.home_school\.slug \}\}/);
  assert.match(routeSource, /safeHTTPURL\(profile\.avatar_url\)/);
  assert.match(routeSource, /safeHTTPURL\(link\.url\)/);
  assert.match(routeSource, /viewer === "self"/);
  assert.match(routeSource, /This is your profile\./);
  assert.match(routeSource, /viewer === "anonymous"/);
  assert.match(routeSource, /to="\/login"/);
  assert.match(routeSource, /search=\{\{ next: `\/users\/\$\{profileID\}` \}\}/);
  assert.match(routeSource, /<ReportUserForm userID=\{profileID\}/);
  assert.match(routeSource, /action=\{reportUser\.url\}/);
  assert.match(routeSource, /method="post"/);
  assert.match(routeSource, /name="user_id"/);
  assert.match(routeSource, /name="reason"/);
  assert.match(routeSource, /maxLength=\{2000\}/);
  assert.match(routeSource, /required/);
  assert.match(routeSource, /useServerFn\(reportUser\)/);
  assert.match(routeSource, /formEvent\.preventDefault\(\)/);
  assert.match(routeSource, /role=\{result\.status === "error" \? "alert" : "status"\}/);
  assert.match(routeSource, /validateSearch: validatePublicProfileSearch/);
  assert.doesNotMatch(routeSource, /Profile reporting is not available yet/);
});

test("report-user server boundary is private, validated, and supports bounded no-JS redirects", () => {
  assert.match(functionSource, /createServerFn\(\{[\s\S]*method: "POST"/);
  assert.match(functionSource, /strict: \{ input: false \}/);
  assert.match(functionSource, /validateReportUserServerInput\(input\)/);
  assert.match(functionSource, /setPrivateNoStoreResponse\(\)/);
  assert.match(functionSource, /isNativeFormPost\(\)/);
  assert.match(functionSource, /currentSessionRequest\(\)/);
  assert.match(functionSource, /cookieHeader: request\.cookieHeader/);
  assert.match(functionSource, /reportUserNativeDestination\(/);
  assert.match(functionSource, /statusCode: 303/);
  assert.doesNotMatch(functionSource, /data\.cookie|input\.cookie|reason.*href/);
});
