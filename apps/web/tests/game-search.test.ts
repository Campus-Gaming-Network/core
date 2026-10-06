import assert from "node:assert/strict";
import test from "node:test";
import { gameSearchApiResponse } from "../src/features/game-picker/game-search-api.server.js";
import { ApiError, type ApiClient } from "../src/server/api.server.js";

function searchAPI(respond: () => unknown) {
  const calls: Array<{ path: string; cookieHeader?: string }> = [];
  const api = (async (options) => {
    calls.push({ path: options.path, cookieHeader: options.cookieHeader });
    const data = respond();
    if (data instanceof Error) throw data;
    return { data, response: Response.json({}) };
  }) as ApiClient;
  return { calls, dependencies: { api, cookieHeader: "cgn_session=abc" } };
}

async function outcome(response: Response) {
  return {
    status: response.status,
    body: await response.json(),
    cache: response.headers.get("cache-control"),
  };
}

test("a game search goes to the API with the session and may be reused briefly by the browser", async () => {
  const games = [
    { igdb_id: 11198, name: "Rocket League", release_year: 2015 },
    { igdb_id: 7, name: "Rocket Arena", game_id: "game-7" },
  ];
  const { calls, dependencies } = searchAPI(() => ({ games }));
  const response = await gameSearchApiResponse(
    new Request(
      "https://cgn.example/api/games/igdb-search?q=%20rocket%20%26%20co",
    ),
    dependencies,
  );

  assert.deepEqual(
    {
      ...(await outcome(response)),
      calls,
    },
    {
      status: 200,
      body: { games },
      cache: "private, max-age=300",
      calls: [
        {
          path: "/games/igdb-search?q=rocket+%26+co",
          cookieHeader: "cgn_session=abc",
        },
      ],
    },
  );
});

test("a game search reports what the picker can act on and hides the rest", async () => {
  const search = (query: string, respond: () => unknown = () => ({})) => {
    const api = searchAPI(respond);
    return gameSearchApiResponse(
      new Request(`https://cgn.example/api/games/igdb-search?q=${query}`),
      api.dependencies,
    ).then(outcome);
  };

  assert.deepEqual(
    {
      short: await search("r"),
      signedOut: await search(
        "rocket",
        () => new ApiError(401, "authentication_required"),
      ),
      limited: await search("rocket", () => new ApiError(429, "rate_limited")),
      off: await search(
        "rocket",
        () => new ApiError(503, "igdb_not_configured"),
      ),
      broken: await search(
        "rocket",
        () => new ApiError(500, "database_detail"),
      ),
      unreachable: await search(
        "rocket",
        () => new Error("connection refused"),
      ),
    },
    {
      short: {
        status: 400,
        body: { error: "invalid_game_query" },
        cache: "private, no-store",
      },
      signedOut: {
        status: 401,
        body: { error: "authentication_required" },
        cache: "private, no-store",
      },
      limited: {
        status: 429,
        body: { error: "rate_limited" },
        cache: "private, no-store",
      },
      off: {
        status: 503,
        body: { error: "igdb_not_configured" },
        cache: "private, no-store",
      },
      broken: {
        status: 503,
        body: { error: "igdb_unavailable" },
        cache: "private, no-store",
      },
      unreachable: {
        status: 503,
        body: { error: "igdb_unavailable" },
        cache: "private, no-store",
      },
    },
  );
});
