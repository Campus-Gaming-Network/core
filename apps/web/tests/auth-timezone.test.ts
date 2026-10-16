import assert from "node:assert/strict";
import test from "node:test";
import { describeTimeZone } from "../src/features/auth-flow-slice/timezone.js";

test("describeTimeZone names a zone the way a person would", () => {
  assert.deepEqual(
    [
      describeTimeZone("America/New_York"),
      describeTimeZone(" America/Los_Angeles "),
      describeTimeZone("Not/AZone"),
      describeTimeZone(""),
    ],
    ["Eastern Time", "Pacific Time", undefined, undefined],
  );
});
