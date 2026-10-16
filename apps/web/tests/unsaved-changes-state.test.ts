import assert from "node:assert/strict";
import test from "node:test";
import {
  isDirty,
  shouldConfirmLeave,
  sortSnapshot,
  type FormSnapshot,
} from "../src/components/unsaved-changes-state.js";

const loaded: FormSnapshot = sortSnapshot([
  ["name", "Spring Smash"],
  ["game_ids", "a"],
  ["game_ids", "b"],
]);

test("a form is clean until a value, an added value or a removed value differs", () => {
  assert.deepEqual(
    [
      isDirty(
        loaded,
        sortSnapshot([
          ["game_ids", "b"],
          ["game_ids", "a"],
          ["name", "Spring Smash"],
        ]),
      ),
      isDirty(
        loaded,
        sortSnapshot([
          ["name", "Fall Smash"],
          ...loaded.slice(0, 0),
          ["game_ids", "a"],
          ["game_ids", "b"],
        ]),
      ),
      isDirty(loaded, [...loaded, ["description", "x"]]),
      isDirty(loaded, loaded.slice(1)),
      isDirty(
        loaded,
        sortSnapshot([
          ["name", "Spring Smash"],
          ["game_ids", "a"],
          ["game_ids", "c"],
        ]),
      ),
    ],
    [false, true, true, true, true],
  );
});

test("only a dirty, idle form leaving its page asks to confirm", () => {
  const base = {
    dirty: true,
    submitting: false,
    currentPathname: "/teams/new",
    nextPathname: "/teams",
  };
  assert.deepEqual(
    [
      shouldConfirmLeave(base),
      shouldConfirmLeave({ ...base, dirty: false }),
      shouldConfirmLeave({ ...base, submitting: true }),
      shouldConfirmLeave({ ...base, nextPathname: "/teams/new" }),
    ],
    [true, false, false, false],
  );
});
