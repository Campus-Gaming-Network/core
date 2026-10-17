import assert from "node:assert/strict";
import test from "node:test";
import { formatTimestamp } from "../src/components/format-timestamp.js";

test("a timestamp reads in the admin's time zone and names the zone", () => {
  // A report submitted Mon Oct 12 at 10:14 PM US Pacific time.
  const submitted = "2026-10-13T05:14:00Z";

  // ICU releases differ on whether a narrow no-break space precedes AM/PM.
  assert.deepEqual(
    ["America/Los_Angeles", "UTC"].map((timeZone) =>
      formatTimestamp(submitted, timeZone).replace(/\s/g, " "),
    ),
    ["Oct 12, 2026, 10:14 PM PDT", "Oct 13, 2026, 5:14 AM UTC"],
  );
});
