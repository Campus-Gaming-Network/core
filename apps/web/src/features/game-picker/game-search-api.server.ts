import { ApiError, type ApiClient } from "../../server/api.server.js";
import { gameSearchResponseSchema } from "./contracts.js";

type Dependencies = {
  api: ApiClient;
  cookieHeader: string;
};

/**
 * Answers the game picker's IGDB search. The Go API does the search, caches
 * it, and requires a session; the browser never contacts IGDB.
 */
export async function gameSearchApiResponse(
  request: Request,
  { api, cookieHeader }: Dependencies,
): Promise<Response> {
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (query.length < 2 || query.length > 100) {
    return json({ error: "invalid_game_query" }, 400);
  }
  try {
    const { data } = await api({
      path: `/games/igdb-search?${new URLSearchParams({ q: query })}`,
      cookieHeader,
      responseSchema: gameSearchResponseSchema,
    });
    return json(data, 200);
  } catch (error) {
    // The picker tells "not signed in", "slow down", and "search is off"
    // apart; anything else is an outage.
    return error instanceof ApiError && [401, 429, 503].includes(error.status)
      ? json({ error: error.code }, error.status)
      : json({ error: "igdb_unavailable" }, 503);
  }
}

function json(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "cache-control": "private, no-store" },
  });
}
