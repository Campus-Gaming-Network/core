import type { GameSearchMatch } from "./contracts.js";

export const maximumPickedGames = 5;

export function gameMatchTitle(
  match: Pick<GameSearchMatch, "name"> &
    Partial<Pick<GameSearchMatch, "release_year">>,
): string {
  return match.release_year
    ? `${match.name} (${match.release_year})`
    : match.name;
}

/**
 * The portrait cover URL for a match: the catalog's stored cover when it
 * serves one, else IGDB's small cover proxied through the site. A match with
 * neither gets the fallback tile.
 */
export function gameMatchCoverURL(
  match: Partial<
    Pick<GameSearchMatch, "slug" | "has_cover" | "cover_image_id">
  >,
): string | undefined {
  if (match.slug && match.has_cover) {
    return `/api/games/${encodeURIComponent(match.slug)}/cover`;
  }
  return match.cover_image_id
    ? `/api/igdb-covers/${encodeURIComponent(match.cover_image_id)}`
    : undefined;
}
