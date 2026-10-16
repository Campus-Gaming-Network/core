import assert from "node:assert/strict";
import test from "node:test";
import { nextActiveIndex } from "../src/components/listbox-navigation.js";
import { schoolSearchMessage } from "../src/components/school-search-status.js";
import {
  gameMatchCoverURL,
  gameMatchTitle,
} from "../src/features/game-picker/picker-helpers.js";

test("arrow keys move and wrap through the options, and Home and End jump", () => {
  assert.deepEqual(
    [
      nextActiveIndex(-1, 3, "ArrowDown"),
      nextActiveIndex(0, 3, "ArrowDown"),
      nextActiveIndex(2, 3, "ArrowDown"),
      nextActiveIndex(-1, 3, "ArrowUp"),
      nextActiveIndex(0, 3, "ArrowUp"),
      nextActiveIndex(2, 3, "ArrowUp"),
      nextActiveIndex(1, 3, "Home"),
      nextActiveIndex(1, 3, "End"),
      nextActiveIndex(0, 0, "ArrowDown"),
    ],
    [0, 1, 0, 2, 2, 1, 0, 2, -1],
  );
});

test("game titles and covers", () => {
  assert.deepEqual(
    [
      gameMatchTitle({ name: "Rocket League", release_year: 2015 }),
      gameMatchTitle({ name: "Rocket Arena" }),
      gameMatchCoverURL({ slug: "rocket league", has_cover: true }),
      gameMatchCoverURL({
        slug: "rocket-league",
        has_cover: true,
        cover_image_id: "co1",
      }),
      gameMatchCoverURL({ cover_image_id: "co5w0w" }),
      gameMatchCoverURL({ slug: "rocket-league", has_cover: false }),
      gameMatchCoverURL({ has_cover: true }),
    ],
    [
      "Rocket League (2015)",
      "Rocket Arena",
      "/api/games/rocket%20league/cover",
      "/api/games/rocket-league/cover",
      "/api/igdb-covers/co5w0w",
      undefined,
      undefined,
    ],
  );
});

test("the school search line covers each state", () => {
  const base = { state: "success", query: "ohio", count: 3 } as const;
  assert.deepEqual(
    [
      schoolSearchMessage({ ...base, query: " o " }),
      schoolSearchMessage({ ...base, state: "loading" }),
      schoolSearchMessage({ ...base, state: "error" }),
      schoolSearchMessage({ ...base, count: 0 }),
      schoolSearchMessage(base),
    ],
    [
      "Type at least two characters to search.",
      "Searching schools…",
      "We couldn’t load schools. Check your connection and try again.",
      "No schools match “ohio”. Try a different spelling or fewer words.",
      "3 schools found. Use the arrow keys, then Enter to choose.",
    ],
  );
});
