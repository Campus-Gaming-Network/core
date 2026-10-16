import assert from "node:assert/strict";
import test from "node:test";
import {
  eventRelativeDay,
  eventWeekday,
} from "../src/features/event-slice/presentation.js";

// `now` is always passed in, and the expected labels depend only on the
// event's own zone, never the process zone.
const cases = [
  {
    name: "today later the same evening",
    event: { starts_at: "2026-10-16T00:00:00Z", timezone: "America/Chicago" },
    now: "2026-10-15T15:00:00Z",
    want: "Today",
  },
  {
    name: "tomorrow",
    event: { starts_at: "2026-10-16T18:00:00Z", timezone: "America/Chicago" },
    now: "2026-10-15T15:00:00Z",
    want: "Tomorrow",
  },
  {
    name: "nothing for a start two days out",
    event: { starts_at: "2026-10-17T18:00:00Z", timezone: "America/Chicago" },
    now: "2026-10-15T15:00:00Z",
    want: undefined,
  },
  {
    name: "the event's zone, not UTC: 01:00Z is still the previous evening in Chicago",
    event: { starts_at: "2026-10-16T01:00:00Z", timezone: "America/Chicago" },
    now: "2026-10-15T20:00:00Z",
    want: "Today",
  },
  {
    name: "today in Tokyo, where the viewer instant is already the 16th",
    event: { starts_at: "2026-10-16T01:00:00Z", timezone: "Asia/Tokyo" },
    now: "2026-10-15T20:00:00Z",
    want: "Today",
  },
  {
    name: "tomorrow in Tokyo while it is still the 15th in UTC",
    event: { starts_at: "2026-10-16T16:00:00Z", timezone: "Asia/Tokyo" },
    now: "2026-10-15T20:00:00Z",
    want: "Tomorrow",
  },
  {
    name: "one minute before local midnight is still tomorrow",
    event: { starts_at: "2026-10-16T13:00:00Z", timezone: "America/Chicago" },
    now: "2026-10-16T04:59:00Z",
    want: "Tomorrow",
  },
  {
    name: "local midnight rolls the same event to today",
    event: { starts_at: "2026-10-16T13:00:00Z", timezone: "America/Chicago" },
    now: "2026-10-16T05:00:00Z",
    want: "Today",
  },
  {
    name: "the evening before is tomorrow",
    event: { starts_at: "2026-10-17T13:00:00Z", timezone: "America/Chicago" },
    now: "2026-10-17T04:59:00Z",
    want: "Tomorrow",
  },
  {
    name: "spring-forward day (23 hours) still counts as one day",
    event: { starts_at: "2026-03-08T18:00:00Z", timezone: "America/Chicago" },
    now: "2026-03-07T08:00:00Z",
    want: "Tomorrow",
  },
  {
    name: "the day after spring-forward from just before it",
    event: { starts_at: "2026-03-09T15:00:00Z", timezone: "America/Chicago" },
    now: "2026-03-08T07:30:00Z",
    want: "Tomorrow",
  },
  {
    name: "fall-back day (25 hours) still counts as one day",
    event: { starts_at: "2026-11-01T20:00:00Z", timezone: "America/Chicago" },
    now: "2026-10-31T05:30:00Z",
    want: "Tomorrow",
  },
  {
    name: "tomorrow across a year boundary",
    event: { starts_at: "2027-01-01T18:00:00Z", timezone: "America/New_York" },
    now: "2026-12-31T15:00:00Z",
    want: "Tomorrow",
  },
  {
    name: "tomorrow across a month boundary",
    event: { starts_at: "2026-11-01T18:00:00Z", timezone: "America/New_York" },
    now: "2026-10-31T15:00:00Z",
    want: "Tomorrow",
  },
  {
    name: "nothing once the event has started",
    event: { starts_at: "2026-10-15T14:00:00Z", timezone: "America/Chicago" },
    now: "2026-10-15T15:00:00Z",
    want: undefined,
  },
  {
    name: "nothing for an ended event on an earlier day",
    event: { starts_at: "2026-10-10T14:00:00Z", timezone: "America/Chicago" },
    now: "2026-10-15T15:00:00Z",
    want: undefined,
  },
  {
    name: "nothing at the exact start instant",
    event: { starts_at: "2026-10-15T15:00:00Z", timezone: "America/Chicago" },
    now: "2026-10-15T15:00:00Z",
    want: undefined,
  },
];

for (const { name, event, now, want } of cases) {
  test(`eventRelativeDay gives ${name}`, () => {
    assert.equal(eventRelativeDay(event, new Date(now)), want);
  });
}

test("eventWeekday uses the event's own zone", () => {
  assert.deepEqual(
    [
      eventWeekday({
        starts_at: "2026-10-17T03:00:00Z",
        timezone: "America/Los_Angeles",
      }),
      eventWeekday({
        starts_at: "2026-10-17T03:00:00Z",
        timezone: "Asia/Tokyo",
      }),
    ],
    ["Fri", "Sat"],
  );
});
