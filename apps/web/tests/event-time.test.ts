import assert from "node:assert/strict";
import test from "node:test";
import {
  instantToLocalDateTime,
  localDateTimeToInstant,
} from "../src/features/event-slice/event-time.js";

// The results never depend on the process zone: only the event's zone counts.
test("localDateTimeToInstant reads a local time in the event's zone", () => {
  assert.deepEqual(
    [
      localDateTimeToInstant("2026-10-31T19:00", "America/New_York"),
      localDateTimeToInstant("2026-11-01T00:30", "America/New_York"),
      localDateTimeToInstant("2026-11-01T03:00", "America/New_York"),
      localDateTimeToInstant("2026-11-01T01:30", "America/New_York"),
      localDateTimeToInstant("2026-03-08T02:30", "America/New_York"),
      localDateTimeToInstant("2026-02-30T10:00", "America/New_York"),
      localDateTimeToInstant("2026-10-31T19:00", "Not/AZone"),
      localDateTimeToInstant("2026-07-01T12:00", "America/Phoenix"),
    ],
    [
      { success: true, instant: "2026-10-31T23:00:00.000Z" },
      { success: true, instant: "2026-11-01T04:30:00.000Z" },
      { success: true, instant: "2026-11-01T08:00:00.000Z" },
      { success: false, reason: "ambiguous" },
      { success: false, reason: "nonexistent" },
      { success: false, reason: "invalid_datetime" },
      { success: false, reason: "invalid_timezone" },
      { success: true, instant: "2026-07-01T19:00:00.000Z" },
    ],
  );
});

test("instantToLocalDateTime fills a datetime-local input in the event's zone", () => {
  assert.deepEqual(
    [
      instantToLocalDateTime("2026-11-01T05:30:00Z", "America/New_York"),
      instantToLocalDateTime("2026-11-01T06:30:00Z", "America/New_York"),
      instantToLocalDateTime("2026-11-01T04:30:00Z", "Pacific/Honolulu"),
      instantToLocalDateTime("not a date", "America/New_York"),
      instantToLocalDateTime("2026-11-01T05:30:00Z", "Not/AZone"),
    ],
    ["2026-11-01T01:30", "2026-11-01T01:30", "2026-10-31T18:30", "", ""],
  );
});

test("a local time survives the round trip through its instant", () => {
  const local = "2026-11-01T08:15";
  const result = localDateTimeToInstant(local, "America/Chicago");
  assert.equal(result.success, true);
  assert.equal(
    result.success && instantToLocalDateTime(result.instant, "America/Chicago"),
    local,
  );
});
