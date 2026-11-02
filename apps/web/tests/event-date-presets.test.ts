import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import {
  eventDatePresets,
  localToday,
} from "../src/features/event-slice/event-date-presets.js";

test("date presets count from today, with the weekend running Friday to Sunday", () => {
  assert.deepEqual(eventDatePresets("2026-11-04"), [
    { label: "This weekend", from: "2026-11-06", to: "2026-11-08" },
    { label: "Next 7 days", from: "2026-11-04", to: "2026-11-10" },
    { label: "Next 30 days", from: "2026-11-04", to: "2026-12-03" },
  ]);
});

test("the weekend preset starts today once the weekend has begun", () => {
  assert.deepEqual(
    ["2026-11-06", "2026-11-28", "2026-11-08"].map(
      (today) => eventDatePresets(today)[0],
    ),
    [
      { label: "This weekend", from: "2026-11-06", to: "2026-11-08" },
      { label: "This weekend", from: "2026-11-28", to: "2026-11-29" },
      { label: "This weekend", from: "2026-11-08", to: "2026-11-08" },
    ],
  );
});

test("today is the viewer's calendar day, falling back to Pacific time", () => {
  const lateEvening = new Date("2026-11-03T05:30:00Z");
  assert.deepEqual(
    [
      localToday(lateEvening, "America/Los_Angeles"),
      localToday(lateEvening, "America/New_York"),
      localToday(lateEvening, "Not/A_Zone"),
    ],
    ["2026-11-02", "2026-11-03", "2026-11-02"],
  );
});
