import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EventCounts } from "../src/components/event-counts.js";

test("an event row counts going against the capacity, and a tournament its entries against the cap", () => {
  const rendered = [
    { rsvp_yes_count: 12, interest_count: 3 },
    { rsvp_yes_count: 12, interest_count: 0, capacity: 32 },
    {
      rsvp_yes_count: 0,
      interest_count: 0,
      capacity: 50,
      tournament_entries: {
        entry_type: "solo" as const,
        entry_count: 7,
        entrant_cap: 16,
      },
    },
    {
      rsvp_yes_count: 0,
      interest_count: 0,
      tournament_entries: { entry_type: "team" as const, entry_count: 3 },
    },
  ].map((event) =>
    renderToStaticMarkup(createElement(EventCounts, { event })).replaceAll(
      /<[^>]+>/g,
      "|",
    ),
  );
  assert.deepEqual(
    rendered.map((markup) => markup.split("|").filter(Boolean)),
    [
      ["12 going", "3 interested"],
      ["12 of 32 going"],
      ["7 of 16 registered"],
      ["3 registered"],
    ],
  );
});
