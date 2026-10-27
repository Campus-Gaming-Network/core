import type { SearchFilterOption } from "../../components/search-filter";
import {
  gameFilterOptionsResponseSchema,
  type GameFilterOption,
} from "./contracts";
import { GameTile } from "./game-tile";

export function gameFilterOption(game: GameFilterOption): SearchFilterOption {
  return {
    value: game.slug,
    label: game.name,
    mark: <GameTile coverURL={game.cover_url} />,
  };
}

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
