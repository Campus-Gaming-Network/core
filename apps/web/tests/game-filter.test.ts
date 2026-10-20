import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import {
  catalogGameSearchApiResponse,
  loadGameFilterChoices,
} from "../src/features/game-picker/game-filter.server.js";
import { createApiClient, type Fetcher } from "../src/server/api.server.js";
import { requestURL } from "./fetch-stub.js";

const game = {
  id: "game-1",
  name: "Example Game",
  slug: "example-game",
  cover_url: "/api/games/example-game/cover",
};

function client(fetcher: Fetcher) {
  return createApiClient({ baseUrl: "http://api:8080", fetcher });
}

test("game filter choices name the chosen game and search by query", async () => {
  const requested: string[] = [];
  const api = client(async (input) => {
    const url = requestURL(input);
    requested.push(url);
    return url.includes("?q=")
      ? Response.json({ games: [game] })
      : Response.json(game);
  });

  const choices = await loadGameFilterChoices(
    api,
    { game: game.slug, gameQuery: "Exam" },
    () => assert.fail("no report expected"),
  );

  assert.deepEqual(requested.sort(), [
    "http://api:8080/games/example-game",
    "http://api:8080/games?q=Exam&limit=20",
  ]);
  assert.deepEqual(choices, {
    selectedGame: game,
    games: [game],
    gameSearchFailed: false,
  });
});

test("game filter choices ignore a missing game and report a failed search", async () => {
  const reported: unknown[] = [];
  const missing = await loadGameFilterChoices(
    client(async () =>
      Response.json({ error: "game_not_found" }, { status: 404 }),
    ),
    { game: "gone" },
    (error) => reported.push(error),
  );
  assert.deepEqual(missing, { games: [], gameSearchFailed: false });
  assert.equal(reported.length, 0);

  const failed = await loadGameFilterChoices(
    client(async () => Response.json({ error: "boom" }, { status: 500 })),
    { gameQuery: "exam" },
    (error) => reported.push(error),
  );
  assert.deepEqual(failed, { games: [], gameSearchFailed: true });
  assert.equal(reported.length, 1);
});

test("the game filter search route validates the query and maps failures", async () => {
  const reported: unknown[] = [];
  const respond = (url: string, fetcher: Fetcher) =>
    catalogGameSearchApiResponse(new Request(url), {
      api: client(fetcher),
      reportError: (error) => reported.push(error),
    });
  const never: Fetcher = async () => assert.fail("no API call expected");

  assert.equal(
    (await respond("http://web/api/games/catalog-search", never)).status,
    400,
  );
  assert.equal(
    (
      await respond(
        `http://web/api/games/catalog-search?q=${"a".repeat(101)}`,
        never,
      )
    ).status,
    400,
  );

  const ok = await respond(
    "http://web/api/games/catalog-search?q=exam",
    async () => Response.json({ games: [game] }),
  );
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("cache-control"), "public, max-age=60");
  assert.deepEqual(await ok.json(), { games: [game] });

  const down = await respond(
    "http://web/api/games/catalog-search?q=exam",
    async () => Response.json({ error: "boom" }, { status: 500 }),
  );
  assert.equal(down.status, 503);
  assert.equal(reported.length, 1);
});
