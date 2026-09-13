import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import test from "node:test";
import { accountHead } from "../src/features/account-slice/presentation.js";

const currentDirectory = process.cwd();
const appRoot = basename(currentDirectory) === "web"
  ? currentDirectory
    : join(currentDirectory, "apps/web");

test("account metadata is complete, absolute, and noindex", () => {
  const head = accountHead("https://campus.example.test");
  const meta = new Map(
    head.meta.map((entry) => [
      "name" in entry ? entry.name : "property" in entry ? entry.property : "title",
      entry.content ?? entry.title
    ])
  );

  assert.equal(meta.get("title"), "Account | Campus Gaming Network");
  assert.equal(meta.get("robots"), "noindex,nofollow");
  assert.equal(meta.get("og:title"), meta.get("title"));
  assert.equal(meta.get("og:description"), meta.get("description"));
  assert.equal(meta.get("og:url"), "https://campus.example.test/account");
  assert.equal(meta.get("twitter:card"), "summary");
  assert.equal(meta.get("twitter:title"), meta.get("title"));
  assert.equal(meta.get("twitter:description"), meta.get("description"));
});
const source = readFileSync(join(appRoot, "src/routes/account.tsx"), "utf8");
const functions = readFileSync(
  join(appRoot, "src/features/account-slice/account.functions.ts"),
  "utf8"
);

test("account route is private, noindex, strict, and uses typed registered links", () => {
  assert.match(source, /createFileRoute\("\/account"\)/);
  assert.match(source, /private, no-store/);
  assert.match(source, /accountHead\(loaderData\?\.publicOrigin\)/);
  assert.match(source, /getAccountDashboard\(\)/);
  assert.match(source, /dashboard\.status === "unauthenticated"/);
  assert.match(source, /to="\/users\/\$id"/);
  assert.match(source, /to="\/events\/\$slug"/);
  assert.match(source, /to="\/teams\/\$slug"/);
  assert.match(source, /<RoutePending message="Loading your account…"/);
});

test("account mutations retain native POST actions and server-side cookie deletion", () => {
  assert.match(source, /action=\{updateAccountProfile\.url\}/);
  assert.match(source, /action=\{deleteAccount\.url\}/);
  assert.match(source, /method="post"/);
  assert.match(functions, /isNativeFormPost\(\)/);
  assert.match(functions, /statusCode: 303/);
  assert.match(functions, /applyCookie: applyCookieMutation/);
  assert.doesNotMatch(source, /password_hash|sessionCookieValue|cookieHeader/);
});
