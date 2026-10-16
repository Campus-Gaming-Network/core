import assert from "node:assert/strict";
import test from "node:test";
import {
  catalogGameMatches,
  catalogGamesFromSummaries,
  chosenGameFields,
  gameSelectMessage,
} from "../src/features/game-picker/game-select-helpers.js";

const catalog = catalogGamesFromSummaries([
  {
    id: "g1",
    name: "Rocket League",
    slug: "rocket-league",
    cover_url: "https://cgn.example/api/games/rocket-league/cover",
  },
  { id: "g2", name: "League of Legends", slug: "league-of-legends" },
  { id: "g3", name: "Valorant", slug: "valorant" },
]);

test("catalog games keep a site-relative cover only when the API serves one", () => {
  assert.deepEqual(catalog, [
    {
      id: "g1",
      name: "Rocket League",
      coverURL: "/api/games/rocket-league/cover",
    },
    { id: "g2", name: "League of Legends" },
    { id: "g3", name: "Valorant" },
  ]);
});

test("catalog matching ignores case and shows everything for an empty query", () => {
  assert.deepEqual(
    catalogGameMatches(catalog, "LEAGUE").map((game) => game.id),
    ["g1", "g2"],
  );
  assert.deepEqual(
    catalogGameMatches(catalog, "  ").map((game) => game.id),
    ["g1", "g2", "g3"],
  );
});

test("a chosen game is submitted by catalog id when the catalog holds it, else by IGDB id", () => {
  assert.deepEqual(
    [
      chosenGameFields({
        kind: "catalog",
        game: { id: "g3", name: "Valorant" },
      }),
      chosenGameFields({
        kind: "igdb",
        match: { igdb_id: 7, name: "Held", game_id: "g9" },
      }),
      chosenGameFields({
        kind: "igdb",
        match: { igdb_id: 1022, name: "Zelda" },
      }),
    ],
    [
      { name: "game_ids", value: "g3" },
      { name: "game_ids", value: "g9" },
      { name: "igdb_game_ids", value: "1022" },
    ],
  );
});

test("the field's message follows the query, the IGDB search, and the IGDB limit", () => {
  const base = { catalogCount: 2, igdbCount: 3, igdbChosen: 0 };
  assert.deepEqual(
    [
      gameSelectMessage({ ...base, query: "r", igdbState: "idle" }),
      gameSelectMessage({ ...base, query: "ro", igdbState: "loading" }),
      gameSelectMessage({ ...base, query: "ro", igdbState: "done" }),
      gameSelectMessage({
        ...base,
        query: "zz",
        igdbState: "done",
        catalogCount: 0,
        igdbCount: 0,
      }),
      gameSelectMessage({ ...base, query: "ro", igdbState: "limited" }),
      gameSelectMessage({
        ...base,
        query: "ro",
        igdbState: "done",
        igdbChosen: 5,
      }),
    ],
    [
      "Type a game's name. Games on CGN show first, then more from IGDB.",
      "2 on CGN. Searching IGDB…",
      "5 games found. Use the arrow keys, then Enter to add.",
      "No games match “zz”. Type the game's name below instead.",
      "2 on CGN. Too many searches. Please try again later.",
      "You have added 5 games from IGDB, the most for one save. Games already on CGN can still be added.",
    ],
  );
});
