import assert from "node:assert/strict";
import test from "node:test";
import {
  instantToLocalDateTime,
  localDateTimeToInstant
} from "../lib/event-time.js";

test("local event times convert to and from offset-bearing instants", () => {
  assert.deepEqual(
    localDateTimeToInstant("2026-08-15T13:00", "America/Los_Angeles"),
    { success: true, instant: "2026-08-15T20:00:00.000Z" }
  );
  assert.equal(
    instantToLocalDateTime(
      "2026-08-15T20:00:00Z",
      "America/Los_Angeles"
    ),
    "2026-08-15T13:00"
  );
});

test("local event time conversion identifies DST gaps and overlaps", () => {
  assert.deepEqual(
    localDateTimeToInstant("2026-03-08T02:30", "America/Los_Angeles"),
    { success: false, reason: "nonexistent" }
  );
  assert.deepEqual(
    localDateTimeToInstant("2026-11-01T01:30", "America/Los_Angeles"),
    { success: false, reason: "ambiguous" }
  );
});

test("local event time conversion rejects invalid dates and zones", () => {
  assert.deepEqual(
    localDateTimeToInstant("2026-02-30T13:00", "America/Los_Angeles"),
    { success: false, reason: "invalid_datetime" }
  );
  assert.deepEqual(localDateTimeToInstant("2026-08-15T13:00", "Mars/Base"), {
    success: false,
    reason: "invalid_timezone"
  });
});
