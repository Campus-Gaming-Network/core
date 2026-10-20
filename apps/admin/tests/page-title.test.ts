import assert from "node:assert/strict";
import test from "node:test";
import { adminTitle } from "../src/components/page-title.js";
import {
  pageAnnouncement,
  shouldMoveFocus,
} from "../src/components/route-focus.js";

test("admin titles put the record first and skip empty parts", () => {
  assert.deepEqual(
    [
      adminTitle(),
      adminTitle("Clubs"),
      adminTitle("Jane Doe", "Users"),
      adminTitle("", "Users"),
    ],
    [
      "CGN Admin",
      "Clubs · CGN Admin",
      "Jane Doe · Users · CGN Admin",
      "Users · CGN Admin",
    ],
  );
});

test("focus moves only for a path change without a hash after the first render", () => {
  const cases = [
    { fromPathname: undefined, toPathname: "/users", toHash: "", want: false },
    { fromPathname: "/users", toPathname: "/users", toHash: "", want: false },
    { fromPathname: "/", toPathname: "/users", toHash: "a", want: false },
    { fromPathname: "/", toPathname: "/users", toHash: "", want: true },
  ];
  assert.deepEqual(
    cases.map(({ want: _want, ...change }) => shouldMoveFocus(change)),
    cases.map(({ want }) => want),
  );
});

test("the announcement prefers the document title and falls back to the heading", () => {
  assert.deepEqual(
    [
      pageAnnouncement(" Users · CGN Admin ", "Users"),
      pageAnnouncement("", " Users "),
    ],
    ["Users · CGN Admin", "Users"],
  );
});
