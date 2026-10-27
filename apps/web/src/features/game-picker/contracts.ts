import * as z from "zod";

// A game may come from the catalog list, from IGDB search, or be typed in.
// These fields ride along with the catalog `game_ids` on event and team forms.
export const pickedIGDBGameIDsSchema = z
  .array(z.coerce.number<string>().int().positive())
  .max(5, "Add five searched games or fewer.")
  .default([]);

export const otherGameSchema = z
  .string()
  .trim()
  .max(100, "Game name must be 100 characters or fewer.")
  .default("");

export const noGameChosenMessage =
  "Choose a game, search for one, or type its name.";

export const gameSearchResponseSchema = z.object({
  games: z.array(
    z.object({
      igdb_id: z.number().int().positive(),
      name: z.string().max(500),
      release_year: z.number().int().optional(),
      game_id: z.string().max(200).optional(),
      // A catalog game's cover is served by slug; the API sends these only for
      // games the catalog already holds.
      slug: z.string().max(200).optional(),
      has_cover: z.boolean().optional(),
      // IGDB's cover, served small at /api/igdb-covers/{id}. An ID the site
      // would not serve is dropped, so the result shows the fallback tile.
      cover_image_id: z
        .string()
        .regex(/^[a-z0-9_]{1,64}$/)
        .optional()
        .catch(undefined),
    }),
  ),
});
export type GameSearchMatch = z.output<
  typeof gameSearchResponseSchema
>["games"][number];

export const gamePickerErrorMessages = {
  game_unavailable: "That game is not available. Choose another one.",
  igdb_game_not_found: "That game could not be found. Search again.",
  igdb_not_configured:
    "Game search is unavailable. Type the game's name instead.",
  igdb_unavailable:
    "Game search is unavailable right now. Type the game's name instead.",
  invalid_game_name: "Enter a game name using letters or numbers.",
} as const;

export const gameFilterOptionSchema = z.object({
  id: z.string().trim().min(1).max(200),
  name: z.string(),
  slug: z.string().trim().min(1).max(200),
  cover_url: z.string().optional(),
});

export const gameFilterOptionsResponseSchema = z.object({
  games: z.array(gameFilterOptionSchema),
});

export type GameFilterOption = z.output<typeof gameFilterOptionSchema>;

export type GameFilterChoices = {
  /** The game named by the `game` filter; absent when it cannot be found. */
  selectedGame?: GameFilterOption;
  /** Matches for the no-JavaScript `game_q` search. */
  games: GameFilterOption[];
  gameSearchFailed: boolean;
};

export const gameFilterInputSchema = z.object({
  game: z.string().trim().min(1).max(200).optional(),
  gameQuery: z.string().trim().max(100).optional(),
});
