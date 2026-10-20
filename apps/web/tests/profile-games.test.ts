import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import { createApiClient, type Fetcher } from "../src/server/api.server.js";
import {
  validateAddProfileGamesInput,
  validateMoveProfileGameInput,
  validateRemoveProfileGameInput,
  type AddProfileGamesInput,
} from "../src/features/profile-games/contracts.js";
import {
  addProfileGamesOperation,
  moveProfileGameOperation,
  profileGamesPageOperation,
  removeProfileGameOperation,
} from "../src/features/profile-games/profile-games-operations.server.js";
import { bodyText, requestURL } from "./fetch-stub.js";

const gameID = "44444444-4444-4444-8444-444444444444";
const lists = {
  favorite: [
    {
      id: gameID,
      name: "Rocket League",
      slug: "rocket-league",
      cover_url: "https://cgn.example/api/games/rocket-league/cover",
    },
  ],
  like: [],
  want_to_play: [],
};

function client(fetcher: Fetcher) {
  return createApiClient({ baseUrl: "http://api:8080", fetcher });
}

test("the profile games page reads the viewer's lists and the catalog", async () => {
  const calls: Array<{ cookie: string | null; url: string }> = [];
  const api = client(async (input, init) => {
    const url = requestURL(input);
    calls.push({ cookie: new Headers(init?.headers).get("cookie"), url });
    if (url.endsWith("/me/games")) return Response.json({ ...lists, extra: 1 });
    return Response.json({
      games: [{ id: gameID, name: "Rocket League", slug: "rocket-league" }],
    });
  });

  assert.deepEqual(
    {
      result: await profileGamesPageOperation({
        api,
        cookieHeader: "cgn_session=server-only",
      }),
      calls,
    },
    {
      result: {
        status: "ready",
        lists,
        catalog: [{ id: gameID, name: "Rocket League", slug: "rocket-league" }],
      },
      calls: [
        { cookie: "cgn_session=server-only", url: "http://api:8080/me/games" },
        { cookie: null, url: "http://api:8080/games" },
      ],
    },
  );
});

test("profile game changes call the named endpoints and return to the settings page", async () => {
  const calls: Array<{ body: unknown; method?: string; url: string }> = [];
  const api = client(async (input, init) => {
    calls.push({
      body: init?.body ? JSON.parse(bodyText(init)) : undefined,
      method: init?.method,
      url: requestURL(input),
    });
    return Response.json(lists);
  });
  const dependencies = { api, cookieHeader: "cgn_session=server-only" };

  const results = await Promise.all([
    addProfileGamesOperation(
      {
        list: "favorite",
        game_ids: [gameID],
        igdb_game_ids: [1942],
        other_game: "Campus Kart",
      },
      dependencies,
    ),
    removeProfileGameOperation({ game_id: gameID }, dependencies),
    moveProfileGameOperation({ game_id: gameID, position: 2 }, dependencies),
  ]);

  assert.deepEqual(
    { calls, results },
    {
      calls: [
        {
          body: {
            list: "favorite",
            game_ids: [gameID],
            igdb_game_ids: [1942],
            other_game: "Campus Kart",
          },
          method: "POST",
          url: "http://api:8080/me/games",
        },
        {
          body: undefined,
          method: "DELETE",
          url: `http://api:8080/me/games/${gameID}`,
        },
        {
          body: { position: 2 },
          method: "POST",
          url: `http://api:8080/me/games/${gameID}/position`,
        },
      ],
      results: Array.from({ length: 3 }, () => ({
        status: "success",
        redirectTo: "/settings/profile?settings=games-updated#games",
      })),
    },
  );
});

test("a sixth favorite reads as a full list, and other failures as a failed change", async () => {
  const failing = (error: string, status: number) =>
    client(async () => Response.json({ error }, { status }));
  const add: AddProfileGamesInput = {
    list: "favorite",
    game_ids: [gameID],
    igdb_game_ids: [],
    other_game: "",
  };

  assert.deepEqual(
    await Promise.all([
      addProfileGamesOperation(add, {
        api: failing("favorite_games_full", 409),
        cookieHeader: "",
        reportError: () => {},
      }),
      removeProfileGameOperation(
        { game_id: gameID },
        {
          api: failing("listed_game_not_found", 404),
          cookieHeader: "",
          reportError: () => {},
        },
      ),
    ]),
    [
      {
        status: "error",
        message:
          "You can list five favorite games. Remove one before you add another.",
        notice: "favorite-add-failed",
      },
      {
        status: "error",
        message: "That game is no longer in your lists. Reload the page.",
        notice: "games-failed",
      },
    ],
  );
});

test("profile game forms keep a known list and at least one game", () => {
  const add = new FormData();
  add.set("list", " like ");
  add.append("game_ids", gameID);
  add.append("game_ids", "");
  add.set("other_game", " Campus Kart ");
  const empty = new FormData();
  empty.set("list", "like");
  const unknownList = new FormData();
  unknownList.set("list", "best");
  unknownList.append("game_ids", gameID);
  const move = new FormData();
  move.set("game_id", gameID);
  move.set("position", "3");

  assert.deepEqual(
    [
      validateAddProfileGamesInput(add),
      validateAddProfileGamesInput(empty),
      validateAddProfileGamesInput(unknownList).valid,
      validateRemoveProfileGameInput({ game_id: "not-a-game" }).valid,
      validateMoveProfileGameInput(move),
    ],
    [
      {
        valid: true,
        value: {
          list: "like",
          game_ids: [gameID],
          igdb_game_ids: [],
          other_game: "Campus Kart",
        },
      },
      {
        valid: false,
        message: "Check the highlighted fields and try again.",
        fieldErrors: {
          game_ids: ["Choose a game, search for one, or type its name."],
        },
      },
      false,
      false,
      { valid: true, value: { game_id: gameID, position: 3 } },
    ],
  );
});
