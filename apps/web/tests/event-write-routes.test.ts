import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import test from "node:test";

const currentDirectory = process.cwd();
const appRoot =
  basename(currentDirectory) === "web"
    ? currentDirectory
    : join(currentDirectory, "apps/web");

function source(relativePath: string): string {
  return readFileSync(join(appRoot, relativePath), "utf8");
}

test("new-event route is private, noindex, searchable, and progressively enhanced", () => {
  const route = source("src/routes/events.new.tsx");
  const form = source("src/features/event-slice/event-form.tsx");
  const picker = source("src/features/event-slice/event-school-picker.tsx");

  assert.match(route, /createFileRoute\("\/events\/new"\)/);
  assert.match(route, /href: "\/login\?next=\/events\/new"/);
  assert.match(route, /statusCode: 307/);
  assert.match(route, /name: "robots", content: "noindex,nofollow"/);
  assert.match(route, /<NoScriptSchoolSearch action="\/events\/new"/);
  assert.match(route, /defaultSchoolID=\{data\.defaultSchoolID\}/);
  assert.match(route, /defaultTimeZone=\{data\.defaultTimeZone\}/);
  assert.match(route, /<RoutePending message="Loading event form…"/);
  assert.doesNotMatch(route, /result\.message/);

  assert.match(form, /action=\{mode === "create" \? createEvent\.url : updateEvent\.url\}/);
  assert.match(form, /method="post"/);
  assert.match(form, /useEnhancedMutation/);
  assert.match(form, /new FormData\(formEvent\.currentTarget\)/);
  assert.match(form, /mode === "create" \?/);
  assert.match(form, /Repeat settings cannot be changed after an event is created/);
  assert.match(picker, /fetch\(`\/api\/schools\?\$\{search\.toString\(\)\}`/);
  assert.match(picker, /<noscript>/);
  assert.match(picker, /name="school_q"/);
  assert.match(picker, /name="host_school_id"/);
});

test("edit-event route preserves auth redirect, true 404, generic denial, and safe head", () => {
  const route = source("src/routes/events.$slug_.edit.tsx");

  assert.match(route, /createFileRoute\("\/events\/\$slug_\/edit"\)/);
  assert.match(
    route,
    /href: `\/login\?next=\/events\/\$\{encodeURIComponent\(params\.slug\)\}\/edit`/
  );
  assert.match(route, /result\.status === "not_found"/);
  assert.match(route, /throw notFound\(\)/);
  assert.match(route, /data\.status === "denied"/);
  assert.match(route, /data\.reason === "locked"/);
  assert.match(route, /Only an event organizer can change or cancel it/);
  assert.match(route, /head: \(\) =>/);
  assert.match(route, /title: "Edit event \| Campus Gaming Network"/);
  assert.match(route, /name: "robots", content: "noindex,nofollow"/);
  assert.doesNotMatch(
    route.match(/head:[\s\S]*?pendingComponent:/)?.[0] ?? "",
    /data\.event\.title|loaderData.*title/
  );
  assert.match(route, /search\.event === "failed"/);
  assert.match(route, /action=\{`\/events\/\$\{encodeURIComponent\(slug\)\}\/edit`\}/);
});

test("event detail exposes A10, A16, and A23 without disturbing unlock or RSVP", () => {
  const detail = source("src/routes/events.$slug.tsx");
  const functions = source("src/features/event-slice/event.functions.ts");

  for (const action of [
    "setEventInterest.url",
    "cancelEvent.url",
    "reportEvent.url",
    "unlockEvent.url",
    "rsvpEvent.url"
  ]) {
    assert.ok(detail.includes(action), `event detail must use ${action}`);
  }
  assert.match(detail, /to="\/events\/\$slug\/edit"/);
  assert.match(detail, /event\.viewer_can_edit \?/);
  assert.match(detail, /event\.viewer_interested \? "Remove interested"/);
  assert.match(detail, /<ReportEventForm slug=\{event\.slug\}/);
  assert.doesNotMatch(detail, /result\.message.*throw|error\.message/);

  assert.match(functions, /isNativeFormPost\(\)/);
  assert.match(functions, /statusCode: 303/);
  assert.match(functions, /\/events\?event=cancel-failed/);
  assert.match(functions, /\/events\?event=interest-failed/);
  assert.match(functions, /reportEventDestination/);
  assert.match(functions, /"report-submitted" : "report-failed"/);
  assert.match(functions, /eventUnlockHeaders\(data\.value\.slug\)/);
  assert.match(functions, /setPrivateNoStoreResponse\(\)/);
  assert.match(functions, /validateCreateEventServerInput/);
  assert.match(functions, /validateUpdateEventServerInput/);
  assert.match(functions, /validateReportEventServerInput/);
  assert.match(functions, /validateEventInterestServerInput/);
  assert.match(functions, /validateCancelEventServerInput/);
});
