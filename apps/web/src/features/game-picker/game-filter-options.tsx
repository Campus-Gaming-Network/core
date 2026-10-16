import type { SearchFilterOption } from "../../components/search-filter";
import {
  gameFilterOptionsResponseSchema,
  type GameFilterOption,
} from "./contracts";
import { GameTile } from "./game-tile";

/** A game as the directories' game filter lists it: cover and name. */
export function gameFilterOption(game: GameFilterOption): SearchFilterOption {
  return {
    value: game.slug,
    label: game.name,
    mark: <GameTile coverURL={game.cover_url} />,
  };
}

/** Searches the catalog's games by name through the site, for the game filter. */
export async function searchGameFilter(
  query: string,
  signal: AbortSignal,
): Promise<SearchFilterOption[]> {
  const search = new URLSearchParams({ q: query });
  const response = await fetch(
    `/api/games/catalog-search?${search.toString()}`,
    { signal },
  );
  if (!response.ok) throw new Error("game search failed");
  const parsed = gameFilterOptionsResponseSchema.safeParse(
    await response.json(),
  );
  if (!parsed.success) throw new Error("invalid game search response");
  return parsed.data.games.map(gameFilterOption);
}
