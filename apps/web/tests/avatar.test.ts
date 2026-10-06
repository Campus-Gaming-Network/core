import assert from "node:assert/strict";
import test from "node:test";
import { avatarResponse } from "../src/server/avatar.server.js";

const userID = "5b0e7f5c-3f4d-4d8e-9a71-6c2b1e0f9d34";

test("an avatar is a deterministic, private-safe SVG drawn from the id alone", async () => {
  const first = avatarResponse(userID);
  const again = avatarResponse(userID);
  const upperCase = avatarResponse(userID.toUpperCase());
  const other = avatarResponse("9a1c2d3e-4f50-4a61-8b72-7c83d94ea5f6");

  assert.equal(first.status, 200);
  assert.deepEqual(Object.fromEntries(first.headers), {
    "cache-control": "public, max-age=86400, stale-while-revalidate=604800",
    "content-security-policy":
      "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    "content-type": "image/svg+xml; charset=utf-8",
    "x-content-type-options": "nosniff",
  });
  const svg = await first.text();
  assert.match(svg, /^<svg[^>]+xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.equal(await again.text(), svg);
  assert.equal(await upperCase.text(), svg);
  assert.notEqual(await other.text(), svg);
});

test("an avatar can run no script and fetches nothing from anywhere", async () => {
  const svg = await avatarResponse(userID).text();

  assert.doesNotMatch(svg, /<script|<foreignObject|\son\w+=|javascript:/i);
  // Attribution metadata names addresses as inert text. Nothing in the drawing
  // points outside itself: every reference is to an element in the same file,
  // and nothing imports, embeds an image, or paints from another address.
  const references = [
    ...[...svg.matchAll(/\s(?:xlink:)?href="([^"]*)"/g)].map(
      (match) => match[1],
    ),
    ...[...svg.matchAll(/url\(\s*["']?([^)"']*)/g)].map((match) => match[1]),
  ];
  assert.ok(references.length > 0, "the drawing reuses its own parts");
  assert.deepEqual(
    references.filter((reference) => !reference.startsWith("#")),
    [],
  );
  assert.doesNotMatch(svg, /\ssrc=|<image[\s>]|@import/i);
});

test("ids that could not be a user id get no avatar", async () => {
  const invalid = [
    "",
    "a".repeat(65),
    "../secret",
    "a b",
    "<script>",
    "id?x=1",
    "id%2F",
    "user/e2e",
    "é",
  ];

  const responses = invalid.map((id) => avatarResponse(id));

  assert.deepEqual(
    responses.map((response) => response.status),
    invalid.map(() => 404),
  );
  assert.deepEqual(
    await Promise.all(responses.map((response) => response.text())),
    invalid.map(() => ""),
  );
});
