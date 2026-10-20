import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import {
  shouldFocusSearchShortcut,
  type SearchShortcutEvent,
} from "../src/components/directory-results-keys.js";

const base: SearchShortcutEvent = {
  key: "/",
  modified: false,
  targetTag: "BODY",
  targetType: undefined,
  editable: false,
};

test("the search shortcut applies only outside text entry", () => {
  const cases: [string, Partial<SearchShortcutEvent>, boolean][] = [
    ["page body", {}, true],
    ["button", { targetTag: "BUTTON" }, true],
    ["checkbox", { targetTag: "INPUT", targetType: "checkbox" }, true],
    ["search box", { targetTag: "INPUT", targetType: "search" }, false],
    ["text box", { targetTag: "INPUT", targetType: "text" }, false],
    ["select", { targetTag: "SELECT" }, false],
    ["textarea", { targetTag: "TEXTAREA" }, false],
    ["editable", { editable: true }, false],
    ["with ctrl", { modified: true }, false],
    ["other key", { key: "a" }, false],
  ];
  for (const [name, change, want] of cases) {
    assert.equal(shouldFocusSearchShortcut({ ...base, ...change }), want, name);
  }
});
