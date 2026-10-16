import assert from "node:assert/strict";
import test from "node:test";
import { eventTimeRange } from "../src/features/event-slice/presentation.js";

// The expected strings are independent of the process time zone because the
// formatter always uses the event's own zone. `now` is fixed so the year rule
// does not depend on when the tests run.
const now = new Date("2026-06-15T12:00:00Z");

const cases = [
  {
    name: "a one-day event this year with its date once and no year",
    event: {
      starts_at: "2026-09-05T00:00:00Z",
      ends_at: "2026-09-05T02:00:00Z",
      timezone: "America/Chicago",
    },
    want: "Sep 4, 7:00 PM – 9:00 PM CDT",
  },
  {
    name: "a one-day event in standard time",
    event: {
      starts_at: "2026-12-04T01:00:00Z",
      ends_at: "2026-12-04T03:00:00Z",
      timezone: "America/Chicago",
    },
    want: "Dec 3, 7:00 PM – 9:00 PM CST",
  },
  {
    name: "an event crossing local midnight with both dates",
    event: {
      starts_at: "2026-09-05T03:00:00Z",
      ends_at: "2026-09-05T07:00:00Z",
      timezone: "America/Los_Angeles",
    },
    want: "Sep 4, 8:00 PM – Sep 5, 12:00 AM PDT",
  },
  {
    name: "a fall-back night labeling both zones",
    event: {
      starts_at: "2026-11-01T05:30:00Z",
      ends_at: "2026-11-01T07:30:00Z",
      timezone: "America/New_York",
    },
    want: "Nov 1, 1:30 AM EDT – 2:30 AM EST",
  },
  {
    name: "a one-day event next year with the year",
    event: {
      starts_at: "2027-08-12T20:45:00Z",
      ends_at: "2027-08-13T00:45:00Z",
      timezone: "America/Phoenix",
    },
    want: "Aug 12, 2027, 1:45 PM – 5:45 PM MST",
  },
  {
    name: "an event ending in the next year with the year on both dates",
    event: {
      starts_at: "2027-01-01T02:00:00Z",
      ends_at: "2027-01-01T06:00:00Z",
      timezone: "America/New_York",
    },
    want: "Dec 31, 2026, 9:00 PM – Jan 1, 2027, 1:00 AM EST",
  },
];

for (const { name, event, want } of cases) {
  test(`eventTimeRange renders ${name}`, () => {
    assert.equal(eventTimeRange(event, now), want);
  });
}

// A directory row's calendar tile shows the start date, so its text leaves
// the start date out and keeps a later end date.
test("eventTimeRange leaves the start date out for a row with a calendar tile", () => {
  const rows = [cases[0], cases[2], cases[3], cases[5]].map(({ event }) =>
    eventTimeRange(event, now, { startDate: false }),
  );
  assert.deepEqual(rows, [
    "7:00 PM – 9:00 PM CDT",
    "8:00 PM – Sep 5, 12:00 AM PDT",
    "1:30 AM EDT – 2:30 AM EST",
    "9:00 PM – Jan 1, 2027, 1:00 AM EST",
  ]);
});
