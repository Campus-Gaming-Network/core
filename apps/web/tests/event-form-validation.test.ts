import assert from "node:assert/strict";
import test from "node:test";
import {
  endBeforeStartMessage,
  recurrenceUntilBounds,
  suggestEventEnd,
  validateEventEnd,
  validatePrivatePassword,
  validateRecurrence,
} from "../src/features/event-slice/event-form-validation.js";

test("validateEventEnd", () => {
  const cases = [
    ["2026-11-01T18:00", "2026-11-01T20:00", null],
    ["2026-11-01T18:00", "2026-11-01T18:00", endBeforeStartMessage],
    ["2026-11-01T18:00", "2026-11-01T09:00", endBeforeStartMessage],
    ["2026-11-01T18:00", "", null],
    ["", "2026-11-01T09:00", null],
  ] as const;
  for (const [start, end, want] of cases) {
    assert.equal(validateEventEnd(start, end), want, `${start} ${end}`);
  }
});

test("suggestEventEnd adds two hours across midnight", () => {
  assert.equal(suggestEventEnd("2026-11-01T18:30"), "2026-11-01T20:30");
  assert.equal(suggestEventEnd("2026-12-31T23:00"), "2027-01-01T01:00");
  assert.equal(suggestEventEnd(""), "");
});

test("recurrenceUntilBounds", () => {
  assert.deepEqual(
    recurrenceUntilBounds("2026-11-01T18:00", "2026-11-01T20:00"),
    { min: "2026-11-01", max: "2027-11-01" },
  );
  assert.deepEqual(recurrenceUntilBounds("", ""), { min: "", max: "" });
});

test("validateRecurrence", () => {
  const base = { startsAt: "2026-11-01T18:00", endsAt: "2026-11-01T20:00" };
  const cases = [
    [{ rule: "", until: "" }, {}],
    [{ rule: "weekly", until: "2026-12-01" }, {}],
    [{ rule: "weekly", until: "2026-11-01" }, {}],
    [{ rule: "weekly", until: "2027-11-01" }, {}],
    [
      { rule: "", until: "2026-12-01" },
      { recurrence_rule: "Choose a repeat interval for this end date." },
    ],
    [
      { rule: "weekly", until: "" },
      { recurrence_until: "Choose when the recurrence ends." },
    ],
    [
      { rule: "weekly", until: "2026-10-31" },
      { recurrence_until: "Recurrence must end after the first event." },
    ],
    [
      { rule: "monthly", until: "2027-11-02" },
      { recurrence_until: "Recurrence cannot extend more than one year." },
    ],
  ] as const;
  for (const [input, want] of cases) {
    assert.deepEqual(validateRecurrence({ ...base, ...input }), want);
  }
});

test("validatePrivatePassword", () => {
  const cases = [
    [{ visibility: "public", password: "", mode: "create" }, null],
    [
      { visibility: "unlisted", password: "secret123", mode: "edit" },
      "Only private events use a password. Clear it or choose Private.",
    ],
    [
      { visibility: "private", password: "short", mode: "create" },
      "Private events require a password of at least 8 characters.",
    ],
    [
      { visibility: "private", password: "  seven  ", mode: "create" },
      "Private events require a password of at least 8 characters.",
    ],
    [{ visibility: "private", password: "longenough", mode: "create" }, null],
    [{ visibility: "private", password: "", mode: "edit" }, null],
    [
      { visibility: "private", password: "short", mode: "edit" },
      "A new private-event password must be at least 8 characters.",
    ],
  ] as const;
  for (const [input, want] of cases) {
    assert.equal(validatePrivatePassword(input), want);
  }
});
