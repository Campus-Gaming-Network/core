import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import test from "node:test";
import { lockedEventDtoSchema } from "../src/features/event-slice/contracts.js";

const currentDirectory = process.cwd();
const appRoot =
  basename(currentDirectory) === "web-start"
    ? currentDirectory
    : join(currentDirectory, "apps/web-start");

test("locked event DTO strips private fields before loader serialization", () => {
  const parsed = lockedEventDtoSchema.parse({
    slug: "invite-only-lan",
    visibility: "private",
    locked: true,
    title: "Secret LAN",
    description: "Private event description",
    address: "123 Hidden Street",
    unlock_token: "must-never-cross-the-boundary"
  });

  assert.deepEqual(parsed, {
    slug: "invite-only-lan",
    visibility: "private",
    locked: true
  });
  assert.equal("unlock_token" in parsed, false);
});

test("locked route view accepts only the public shell and navigation state", () => {
  const source = readFileSync(
    join(appRoot, "src/routes/events.$slug.tsx"),
    "utf8"
  );
  const lockedView = source.match(
    /export function LockedEventView[\s\S]*?\nfunction VisibleEventView/
  )?.[0];

  assert.ok(lockedView, "LockedEventView must remain independently auditable");
  assert.doesNotMatch(lockedView, /\bevent\s*\./);
  assert.doesNotMatch(
    lockedView,
    /\b(title|description|address|unlock_token)\b/i
  );
  assert.match(lockedView, /slug: string/);
  assert.match(lockedView, /authenticated: boolean/);
});

test("route heads and search state use bounded privacy-safe values", () => {
  const eventSource = readFileSync(
    join(appRoot, "src/routes/events.$slug.tsx"),
    "utf8"
  );
  const loginSource = readFileSync(join(appRoot, "src/routes/login.tsx"), "utf8");

  assert.match(eventSource, /Private event \|/);
  assert.match(eventSource, /noindex,nofollow/);
  assert.match(eventSource, /event\.visibility === "public"/);
  assert.doesNotMatch(eventSource, /result\.message/);
  assert.match(loginSource, /!value\.startsWith\("\/\/"\)/);
  assert.match(loginSource, /errorValue === "login-failed"/);
  assert.doesNotMatch(loginSource, /result\.message/);
});
