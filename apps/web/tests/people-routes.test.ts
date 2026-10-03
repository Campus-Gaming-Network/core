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

const peopleRoutes = [
  {
    file: "src/routes/events.$slug_.people.tsx",
    route: "/events/$slug_/people",
    entity: "/events/$slug",
    read: "getEventAttendees",
  },
  {
    file: "src/routes/schools.$slug_.people.tsx",
    route: "/schools/$slug_/people",
    entity: "/schools/$slug",
    read: "getSchoolMembers",
  },
  {
    file: "src/routes/teams.$slug_.people.tsx",
    route: "/teams/$slug_/people",
    entity: "/teams/$slug",
    read: "getTeamMembers",
  },
];

for (const { entity, file, read, route } of peopleRoutes) {
  test(`${route} sends visitors to log in, hides missing lists, and stays private and out of search`, () => {
    const page = source(file);

    assert.ok(page.includes(`createFileRoute("${route}")`));
    assert.match(page, new RegExp(`${read}\\(`));
    assert.match(
      page,
      /people\.status === "signed_out"[\s\S]*?redirect\(\{ to: "\/login", search: \{ next: location\.href \} \}\)/,
    );
    assert.match(
      page,
      /people\.status === "not_found"[\s\S]*?throw notFound\(\)/,
    );
    assert.match(page, /"cache-control": "private, no-store"/);
    assert.match(page, /vary: "Cookie"/);
    assert.match(page, /staleTime: 0/);
    assert.match(page, /peopleHead\(/);
    assert.match(page, /unavailablePeopleHead\(\)/);
    assert.doesNotMatch(page, /result\.message|error\.message/);
  });

  test(`${route} has one heading, a back link to its page, and native pagination links`, () => {
    const page = source(file);

    assert.equal((page.match(/<h1>/g) ?? []).length, 1);
    assert.match(
      page,
      new RegExp(
        `<Link\\s+className="back-link with-arrow"\\s+to="${entity.replace("$", "\\$")}"[\\s\\S]*?<ArrowLeft aria-hidden="true"`,
      ),
    );
    assert.match(page, /<PeopleResults/);
    assert.match(page, /<PeoplePagination/);
    assert.match(page, /search=\{previousSearch\}/);
    assert.match(page, /search=\{nextSearch\}/);
  });
}

test("event attendees offer Going and Maybe as links that keep the tab through pagination", () => {
  const page = source("src/routes/events.$slug_.people.tsx");

  assert.match(page, /validateSearch: validateEventPeopleSearch/);
  assert.match(
    page,
    /loaderDeps: \(\{ search \}\) => eventPeopleInput\(search\)/,
  );
  assert.match(page, /\{ response: "yes", label: "Going" \}/);
  assert.match(page, /\{ response: "maybe", label: "Maybe" \}/);
  assert.match(page, /search=\{\{ response: tab\.response \}\}/);
  assert.match(page, /aria-current=\{tab\.response === response \? "page"/);
  assert.match(page, /\.\.\.\(response === "maybe" \? \{ response \} : \{\}\)/);
});

test("entity pages read a preview only for signed-in viewers and show visitors a log-in prompt", () => {
  const event = source("src/routes/events.$slug.tsx");
  const school = source("src/routes/schools.$slug.tsx");
  const team = source("src/routes/teams.$slug.tsx");

  assert.match(
    event,
    /session\.authenticated && !isLockedEvent\(detail\.event\)[\s\S]*?getEventAttendees/,
  );
  assert.match(event, /response: "yes",\s+limit: peoplePreviewSize/);
  assert.match(event, /to="\/events\/\$slug\/people"/);
  assert.match(
    event,
    /<PeopleSignedOut[\s\S]*?next=\{`\/events\/\$\{event\.slug\}`\}/,
  );

  assert.match(
    school,
    /getSchoolMembers\(\{\s+data: \{ slug: school\.slug, limit: peoplePreviewSize \}/,
  );
  assert.match(school, /to="\/schools\/\$slug\/people"/);
  assert.match(school, /viewer\.authenticated \? \(\s+<PeoplePreview/);
  assert.match(
    school,
    /<PeopleSignedOut[\s\S]*?next=\{`\/schools\/\$\{school\.slug\}`\}/,
  );

  assert.match(
    team,
    /getTeamMembers\(\{\s+data: \{ slug: params\.slug, limit: peoplePreviewSize \}/,
  );
  assert.match(team, /to="\/teams\/\$slug\/people"/);
  assert.match(
    team,
    /viewer === "anonymous" \? \(\s+<div className="people-card">/,
  );
  assert.match(
    team,
    /<PeopleSignedOut[\s\S]*?next=\{`\/teams\/\$\{team\.slug\}`\}/,
  );
});

test("people list server functions are GET reads that never cache a session's response", () => {
  const functions = source("src/features/people-slice/people.functions.ts");

  assert.equal(
    (functions.match(/createServerFn\(\{ method: "GET" \}\)/g) ?? []).length,
    3,
  );
  assert.equal(
    (
      functions.match(
        /if \(request\.sessionCookieValue\) setPrivateNoStoreResponse\(\)/g,
      ) ?? []
    ).length,
    3,
  );
  assert.equal(
    (functions.match(/cookieHeader: request\.cookieHeader/g) ?? []).length,
    3,
  );
  assert.equal(
    (functions.match(/eventUnlockHeaders\(data\.slug\)/g) ?? []).length,
    1,
  );
  assert.doesNotMatch(functions, /method: "POST"/);
});
