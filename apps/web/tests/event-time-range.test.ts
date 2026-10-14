import assert from "node:assert/strict";
import test from "node:test";
import { eventTimeRange } from "../src/features/event-slice/presentation.js";

// The expected strings are independent of the process time zone because the
// formatter always uses the event's own zone.
const cases = [
  {
    name: "Chicago evening in daylight time",
    event: {
      starts_at: "2026-09-05T00:00:00Z",
      ends_at: "2026-09-05T02:00:00Z",
      timezone: "America/Chicago",
    },
    want: "Sep 4, 2026, 7:00 PM CDT – Sep 4, 2026, 9:00 PM CDT",
  },
  {
    name: "Chicago evening in standard time",
    event: {
      starts_at: "2026-12-04T01:00:00Z",
      ends_at: "2026-12-04T03:00:00Z",
      timezone: "America/Chicago",
    },
    want: "Dec 3, 2026, 7:00 PM CST – Dec 3, 2026, 9:00 PM CST",
  },
  {
    name: "event crossing local midnight",
    event: {
      starts_at: "2026-09-05T03:00:00Z",
      ends_at: "2026-09-05T07:00:00Z",
      timezone: "America/Los_Angeles",
    },
    want: "Sep 4, 2026, 8:00 PM PDT – Sep 5, 2026, 12:00 AM PDT",
  },
  {
    name: "fall-back night labeling the repeated hour",
    event: {
      starts_at: "2026-11-01T05:30:00Z",
      ends_at: "2026-11-01T07:30:00Z",
      timezone: "America/New_York",
    },
    want: "Nov 1, 2026, 1:30 AM EDT – Nov 1, 2026, 2:30 AM EST",
  },
];

for (const { name, event, want } of cases) {
  test(`eventTimeRange renders ${name} with the zone abbreviation`, () => {
    assert.equal(eventTimeRange(event), want);
  });
}
