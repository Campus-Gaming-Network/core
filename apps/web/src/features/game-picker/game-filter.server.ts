import { ApiError, type ApiClient } from "../../server/api.server.js";
import {
  gameFilterOptionSchema,
  gameFilterOptionsResponseSchema,
  type GameFilterChoices,
  type GameFilterOption,
} from "./contracts.js";

/** How many catalog games a name search returns. */
const gameFilterSearchLimit = 20;

/** Searches the catalog's active games by name, best matches first. */
async function searchCatalogGames(
  api: ApiClient,
  query: string,
): Promise<GameFilterOption[]> {
  const search = new URLSearchParams({
    q: query,
    limit: String(gameFilterSearchLimit),
  });
  const { data } = await api({
    path: `/games?${search.toString()}`,
    cache: "no-store",
    responseSchema: gameFilterOptionsResponseSchema,
  });
  return data.games;
}

/**
 * Loads a directory's game filter: the game its `game` slug names, so the
 * filter shows a name and cover instead of a slug, and the matches for a
 * no-JavaScript `game_q` search. The catalog is never loaded whole, so the
 * filter works the same with ten games or ten thousand. A game that is gone
 * is left unnamed without a report; other failures are reported and leave
 * the directory itself working.
 */
export async function loadGameFilterChoices(
  api: ApiClient,
  { game, gameQuery }: { game?: string; gameQuery?: string },
  reportError: (error: unknown) => void,
): Promise<GameFilterChoices> {
  const [selectedGame, search] = await Promise.all([
    game
      ? api({
          path: `/games/${encodeURIComponent(game)}`,
          cache: "no-store",
          responseSchema: gameFilterOptionSchema,
        })
          .then(({ data }) => data)
          .catch((error: unknown) => {
            if (!(error instanceof ApiError && error.status === 404)) {
              reportError(error);
            }
            return undefined;
          })
      : Promise.resolve(undefined),
    gameQuery
      ? searchCatalogGames(api, gameQuery)
          .then((games) => ({ games, failed: false }))
          .catch((error: unknown) => {
            reportError(error);
            return { games: [], failed: true };
          })
      : Promise.resolve({ games: [], failed: false }),
  ]);

  return {
    ...(selectedGame ? { selectedGame } : {}),
    games: search.games,
    gameSearchFailed: search.failed,
  };
}

/**
 * Answers the game filter's search from the browser: the catalog's active
 * games whose name contains `q` (1 to 100 characters), best matches first.
 * Public, like the catalog itself.
 */
export async function catalogGameSearchApiResponse(
  request: Request,
  {
    api,
    reportError,
  }: { api: ApiClient; reportError: (error: unknown) => void },
): Promise<Response> {
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (query.length < 1 || query.length > 100) {
    return Response.json({ error: "invalid_game_query" }, { status: 400 });
  }
  try {
    const games = await searchCatalogGames(api, query);
    return Response.json(
      { games },
      { headers: { "cache-control": "public, max-age=60" } },
    );
  } catch (error) {
    reportError(error);
    return Response.json({ error: "games_unavailable" }, { status: 503 });
  }
}
