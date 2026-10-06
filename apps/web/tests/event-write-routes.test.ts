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

test("edit-event route preserves auth redirect, true 404, generic denial, and safe head", () => {
  const route = source("src/routes/events.$slug_.edit.tsx");

  assert.match(route, /createFileRoute\("\/events\/\$slug_\/edit"\)/);
  assert.match(
    route,
    /href: `\/login\?next=\/events\/\$\{encodeURIComponent\(params\.slug\)\}\/edit`/,
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
    /data\.event\.title|loaderData.*title/,
  );
  assert.match(route, /search\.event === "failed"/);
  assert.match(
    route,
    /action=\{`\/events\/\$\{encodeURIComponent\(slug\)\}\/edit`\}/,
  );
});
