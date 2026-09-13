import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import test from "node:test";

const currentDirectory = process.cwd();
const appRoot =
  basename(currentDirectory) === "web-start"
    ? currentDirectory
    : join(currentDirectory, "apps/web-start");
const browseSource = readFileSync(
  join(appRoot, "src/routes/teams.index.tsx"),
  "utf8"
);
const detailSource = readFileSync(
  join(appRoot, "src/routes/teams.$slug.tsx"),
  "utf8"
);
const newSource = readFileSync(
  join(appRoot, "src/routes/teams.new.tsx"),
  "utf8"
);
const functionSource = readFileSync(
  join(appRoot, "src/features/team-slice/team.functions.ts"),
  "utf8"
);

test("team routes use the strict shared viewer state without serializing a profile", () => {
  assert.match(browseSource, /getEventViewerSession\(\)/);
  assert.match(detailSource, /getEventViewerSession\(\)/);
  assert.match(browseSource, /session\.status === "unavailable"/);
  assert.match(detailSource, /session\.status === "unavailable"/);
  assert.match(detailSource, /detail\.viewerRole \?\? "non_member"/);
  assert.match(detailSource, /: "anonymous"/);
  assert.doesNotMatch(detailSource, /viewer\.email/);
  assert.doesNotMatch(detailSource, /viewer\.id/);
  assert.doesNotMatch(functionSource, /\/me/);
  assert.match(functionSource, /hasSessionCookie \? request\.cookieHeader : ""/);
  assert.match(functionSource, /setViewerResponseCache\(hasSessionCookie\)/);
});

test("team browse preserves native GET filters, cursor pagination, and typed routes", () => {
  assert.match(browseSource, /<form action="\/teams"/);
  assert.match(browseSource, /method="get"/);
  assert.match(browseSource, /name="game"/);
  assert.match(browseSource, /name="school"/);
  assert.match(browseSource, /before: catalog\.previous_cursor/);
  assert.match(browseSource, /after: catalog\.next_cursor/);
  assert.match(browseSource, /to="\/teams\/\$slug"/);
  assert.match(browseSource, /params=\{\{ slug: team\.slug \}\}/);
  assert.match(browseSource, /to="\/teams\/new"/);
  assert.match(browseSource, /search=\{\{ next: "\/teams\/new" \}\}/);
});

test("team detail has real 404, same-DTO head, bounded notices, and typed links", () => {
  assert.match(detailSource, /throw notFound\(\)/);
  assert.match(detailSource, /teamHead\(loaderData\?\.team/);
  assert.match(detailSource, /to="\/schools\/\$slug"/);
  assert.match(detailSource, /to="\/login"/);
  assert.match(detailSource, /search=\{\{ next: `\/teams\/\$\{slug\}` \}\}/);
  assert.match(detailSource, /TeamNoticeMessage/);
  assert.doesNotMatch(detailSource, /result\.message/);
});

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

test("join and owner management retain native forms and enhanced invalidation redirects", () => {
  assert.match(detailSource, /function TeamJoinForm/);
  assert.match(detailSource, /action=\{joinTeam\.url\}/);
  assert.match(detailSource, /useServerFn\(joinTeam\)/);
  assert.match(detailSource, /team-join-password-error/);
  assert.match(detailSource, /function TeamManagementPanel/);
  assert.match(detailSource, /action=\{setTeamCaptain\.url\}/);
  assert.match(detailSource, /action=\{transferTeamOwnership\.url\}/);
  assert.match(detailSource, /router\.invalidate\(\)/);
  assert.match(detailSource, /team=manage-failed/);
  assert.doesNotMatch(detailSource, /Phase 4 gap/);
});

test("team server functions derive request authority and bound native redirects", () => {
  assert.equal(
    (functionSource.match(/method: "POST"/g) ?? []).length,
    4
  );
  assert.equal(
    (functionSource.match(/strict: \{ input: false \}/g) ?? []).length,
    4
  );
  assert.match(functionSource, /currentSessionRequest\(\)/);
  assert.match(functionSource, /isNativeFormPost\(\)/);
  assert.match(functionSource, /setPrivateNoStoreResponse\(\)/);
  assert.match(functionSource, /statusCode: 303/);
  assert.match(functionSource, /validateCreateTeamServerInput/);
  assert.match(functionSource, /validateJoinTeamServerInput/);
  assert.match(functionSource, /validateSetTeamCaptainServerInput/);
  assert.match(functionSource, /validateTransferTeamOwnershipServerInput/);
  assert.match(functionSource, /teamFailureDestination/);
  assert.doesNotMatch(functionSource, /cookieHeader.*data/);
  assert.doesNotMatch(functionSource, /viewer_role/);
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
