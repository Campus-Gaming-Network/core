import assert from "node:assert/strict";
import test from "node:test";
import {
  isDirty,
  shouldConfirmLeave,
  sortSnapshot,
} from "../src/components/unsaved-changes-state.js";

test("a form is dirty only when its entries differ", () => {
  const initial = sortSnapshot([
    ["name", "Chess"],
    ["slug", "chess"],
  ]);
  const reordered = sortSnapshot([
    ["slug", "chess"],
    ["name", "Chess"],
  ]);
  assert.deepEqual(
    [
      isDirty(initial, reordered),
      isDirty(initial, [["name", "Chess"]]),
      isDirty(initial, [
        ["name", "Chess"],
        ["slug", "go"],
      ]),
    ],
    [false, true, true],
  );
});

test("leaving asks only for a dirty, idle form changing pages", () => {
  const base = {
    dirty: true,
    submitting: false,
    currentPathname: "/schools/a",
    nextPathname: "/schools",
  };
  assert.deepEqual(
    [
      base,
      { ...base, dirty: false },
      { ...base, submitting: true },
      { ...base, nextPathname: "/schools/a" },
    ].map(shouldConfirmLeave),
    [true, false, false, false],
  );
});
