import assert from "node:assert/strict";
import test from "node:test";
import {
  pageAnnouncement,
  shouldMoveFocus,
} from "../src/components/route-focus.js";

test("focus moves only for a path change without a hash after the first render", () => {
  const cases = [
    { fromPathname: undefined, toPathname: "/events", toHash: "", want: false },
    { fromPathname: "/events", toPathname: "/events", toHash: "", want: false },
    { fromPathname: "/", toPathname: "/faq", toHash: "q1", want: false },
    { fromPathname: "/", toPathname: "/faq", toHash: "", want: true },
  ];
  assert.deepEqual(
    cases.map(({ want: _want, ...change }) => shouldMoveFocus(change)),
    cases.map(({ want }) => want),
  );
});

test("the announcement prefers the document title and falls back to the heading", () => {
  assert.deepEqual(
    [pageAnnouncement(" FAQ | CGN ", "FAQ"), pageAnnouncement("", " FAQ ")],
    ["FAQ | CGN", "FAQ"],
  );
});
