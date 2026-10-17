import assert from "node:assert/strict";
import test from "node:test";
import { createApiClient, type Fetcher } from "../src/server/api.server.js";
import { popularGamesOperation } from "../src/features/popular-games/popular-games-operations.server.js";

function client(fetcher: Fetcher) {
  return createApiClient({ baseUrl: "http://api:8080", fetcher });
}

test("popular games read the ranking overall and for one school", async () => {
  const urls: string[] = [];
  const api = client(async (input) => {
    urls.push(String(input));
    return Response.json({
      games: [
        {
          id: "game-1",
          name: "Valorant",
          slug: "valorant",
          cover_url: "https://cgn.example/api/games/valorant/cover",
          upcoming_events: 3,
          extra: true,
        },
        { id: "game-2", name: "Chess", slug: "chess", upcoming_events: 2 },
      ],
    });
  });

  const results = await Promise.all([
    popularGamesOperation({}, { api }),
    popularGamesOperation({ school: "home-school" }, { api }),
  ]);

  const games = [
    {
      id: "game-1",
      name: "Valorant",
      slug: "valorant",
      cover_url: "https://cgn.example/api/games/valorant/cover",
      upcoming_events: 3,
    },
    { id: "game-2", name: "Chess", slug: "chess", upcoming_events: 2 },
  ];
  assert.deepEqual(
    { results, urls },
    {
      results: [
        { status: "ready", games },
        { status: "ready", games },
      ],
      urls: [
        "http://api:8080/popular-games",
        "http://api:8080/popular-games?school=home-school",
      ],
    },
  );
});

test("an unreadable ranking hides the panel instead of failing the page", async () => {
  const results = await Promise.all([
    popularGamesOperation(
      {},
      {
        api: client(async () =>
          Response.json({ error: "games_unavailable" }, { status: 500 }),
        ),
        reportError: () => {},
      },
    ),
    popularGamesOperation(
      {},
      {
        api: client(async () =>
          Response.json({
            games: [{ id: "game-1", name: "Chess", slug: "chess" }],
          }),
        ),
        reportError: () => {},
      },
    ),
  ]);

  assert.deepEqual(results, [
    { status: "unavailable" },
    { status: "unavailable" },
  ]);
});
