import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import {
  activeFilterChips,
  filterFormSearch,
  mostRestrictiveChip,
  resultsAnnouncement,
  type AppliedFilter,
} from "../src/components/directory-filters.js";

const filters: AppliedFilter[] = [
  { key: "game", name: "Game", value: "valorant", label: "Valorant" },
  { key: "format", name: "Format", value: "online", label: "Online" },
  { key: "school", name: "School", value: "cvcc", label: "Cuyahoga" },
];

test("each chip links to the other filters without a page cursor", () => {
  assert.deepEqual(activeFilterChips(filters), [
    {
      key: "game",
      text: "Game: Valorant",
      search: { format: "online", school: "cvcc" },
    },
    {
      key: "format",
      text: "Format: Online",
      search: { game: "valorant", school: "cvcc" },
    },
    {
      key: "school",
      text: "School: Cuyahoga",
      search: { game: "valorant", format: "online" },
    },
  ]);
  assert.deepEqual(activeFilterChips([]), []);
});

test("the most restrictive chip follows the given order", () => {
  const chips = activeFilterChips(filters);
  assert.equal(mostRestrictiveChip(chips, ["school", "game"])?.key, "school");
  assert.equal(mostRestrictiveChip(chips, ["format"])?.key, "format");
  assert.equal(mostRestrictiveChip([], ["school"]), undefined);
});

test("a filter form query keeps only fields with a value", () => {
  assert.deepEqual(
    filterFormSearch([
      ["school", "cvcc"],
      ["game", ""],
      ["format", "online"],
      ["upload", new File([], "x")],
    ]),
    { school: "cvcc", format: "online" },
  );
});

test("the announcement counts results and filters", () => {
  assert.equal(resultsAnnouncement(1, "event", 0), "1 event found.");
  assert.equal(
    resultsAnnouncement(0, "team", 2),
    "0 teams found with 2 filters applied.",
  );
  assert.equal(
    resultsAnnouncement(3, "school", 1),
    "3 schools found with 1 filter applied.",
  );
});
