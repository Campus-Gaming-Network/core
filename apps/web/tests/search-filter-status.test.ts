import assert from "node:assert/strict";
import test from "node:test";
import { searchFilterMessage } from "../src/components/search-filter-status.js";

test("search filter messages hint, show progress, and report the outcome", () => {
  const base = { count: 0, minimumLength: 2, noun: "schools", query: "" };
  assert.deepEqual(
    [
      searchFilterMessage({ ...base, query: "o", state: "idle" }),
      searchFilterMessage({
        ...base,
        minimumLength: 1,
        noun: "games",
        state: "idle",
      }),
      searchFilterMessage({ ...base, query: "ohio", state: "loading" }),
      searchFilterMessage({ ...base, query: "ohio", state: "error" }),
      searchFilterMessage({ ...base, query: " zzz ", state: "success" }),
      searchFilterMessage({
        ...base,
        count: 3,
        query: "ohio",
        state: "success",
      }),
    ],
    [
      "Type at least 2 characters to search schools.",
      "Type to search games.",
      "Searching schools…",
      "We couldn’t search schools. Check your connection and try again.",
      "No schools match “zzz”. Try a different spelling or fewer words.",
      "3 found. Use the arrow keys, then Enter to choose.",
    ],
  );
});
