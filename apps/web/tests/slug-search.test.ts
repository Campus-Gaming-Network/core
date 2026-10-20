import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { slugSearchWords } from "../src/components/slug-search.js";

test("slugSearchWords turns slugs into search words", () => {
  assert.deepEqual(
    [
      slugSearchWords("valorant-night-2026"),
      slugSearchWords("State_University%20of-Texas"),
      slugSearchWords("a-b-c"),
      slugSearchWords("%E0%A4%A"),
      slugSearchWords("one-two-three-four-five-six-seven"),
      slugSearchWords("---"),
      slugSearchWords("café-déjà"),
    ],
    [
      "valorant night 2026",
      "state university of texas",
      "",
      "e0 a4",
      "one two three four five",
      "",
      "café déjà",
    ],
  );
});
