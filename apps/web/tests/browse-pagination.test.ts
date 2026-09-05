import assert from "node:assert/strict";
import test from "node:test";
import { browseHref, pageNumber } from "../lib/browse-pagination.js";

test("browseHref preserves filters in page links", () => {
  assert.equal(
    browseHref("/events", {
      game: "rocket-league",
      school: "example-university",
      format: "in_person",
      after: "opaque cursor"
    }),
    "/events?game=rocket-league&school=example-university&format=in_person&after=opaque+cursor"
  );
  assert.equal(
    browseHref("/schools", { q: "State Tech", state: "CA", page: undefined }),
    "/schools?q=State+Tech&state=CA"
  );
});

test("pageNumber safely defaults invalid page values", () => {
  assert.equal(pageNumber("2"), 2);
  assert.equal(pageNumber(""), 1);
  assert.equal(pageNumber("0"), 1);
  assert.equal(pageNumber("-1"), 1);
  assert.equal(pageNumber("2.5"), 1);
  assert.equal(pageNumber("not-a-page"), 1);
  assert.equal(pageNumber("999999999999999999999999"), 1);
});
