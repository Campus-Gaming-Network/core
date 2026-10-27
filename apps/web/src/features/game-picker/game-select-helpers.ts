import type { GameSearchMatch } from "./contracts.js";
import { maximumPickedGames } from "./picker-helpers.js";

export type CatalogGame = { id: string; name: string; coverURL?: string };

export type ChosenGame =
  | { kind: "catalog"; game: CatalogGame }
  | { kind: "igdb"; match: GameSearchMatch };

/**
 * Catalog games for the game field, from the catalog list (`cover_url` set
 * when the site serves a cover) or an event's games (`has_cover`). The cover
 * is always requested from this site's own route.
 */
export function catalogGamesFromSummaries(
  games: ReadonlyArray<{
    id: string;
    name: string;
    slug: string;
    cover_url?: string;
    has_cover?: boolean;
  }>,
): CatalogGame[] {
  return games.map((game) => ({
    id: game.id,
    name: game.name,
    ...(game.cover_url || game.has_cover
      ? { coverURL: `/api/games/${encodeURIComponent(game.slug)}/cover` }
      : {}),
  }));
}

/**
 * Catalog games whose name contains the query, ignoring case; every catalog
 * game while the query is empty, so focusing the field shows what CGN has.
 */
export function catalogGameMatches(
  catalog: readonly CatalogGame[],
  query: string,
): CatalogGame[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [...catalog];
  return catalog.filter((game) =>
    game.name.toLocaleLowerCase().includes(needle),
  );
}

/**
 * The hidden field a chosen game is submitted in: a catalog game, or an IGDB
 * result the catalog already holds, by its catalog id in `game_ids`; any other
 * IGDB result by its IGDB id in `igdb_game_ids`.
 */
export function chosenGameFields(game: ChosenGame): {
  name: "game_ids" | "igdb_game_ids";
  value: string;
} {
  if (game.kind === "catalog") return { name: "game_ids", value: game.game.id };
  return game.match.game_id
    ? { name: "game_ids", value: game.match.game_id }
    : { name: "igdb_game_ids", value: String(game.match.igdb_id) };
}

export function gameSelectMessage({
  query,
  catalogCount,
  igdbState,
  igdbCount,
  igdbChosen,
}: {
  query: string;
  catalogCount: number;
  igdbState: "idle" | "loading" | "done" | "error" | "limited";
  igdbCount: number;
  igdbChosen: number;
}): string {
  if (igdbChosen >= maximumPickedGames)
    return `You have added ${maximumPickedGames} games from IGDB, the most for one save. Games already on CGN can still be added.`;
  if (query.length < 2)
    return "Type a game's name. Games on CGN show first, then more from IGDB.";
  if (igdbState === "loading") return `${catalogCount} on CGN. Searching IGDB…`;
  if (igdbState === "error")
    return `${catalogCount} on CGN. IGDB search is unavailable; type the game's name below instead.`;
  if (igdbState === "limited")
    return `${catalogCount} on CGN. Too many searches. Please try again later.`;
  const total = catalogCount + igdbCount;
  if (total === 0)
    return `No games match “${query}”. Type the game's name below instead.`;
  return `${total} game${total === 1 ? "" : "s"} found. Use the arrow keys, then Enter to add.`;
}
