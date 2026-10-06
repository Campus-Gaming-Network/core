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
      // Set when the catalog already holds this game.
      game_id: z.string().max(200).optional(),
    }),
  ),
});
export type GameSearchMatch = z.output<
  typeof gameSearchResponseSchema
>["games"][number];

/** Messages for the API's reasons a picked or typed game is refused. */
export const gamePickerErrorMessages = {
  game_unavailable: "That game is not available. Choose another one.",
  igdb_game_not_found: "That game could not be found. Search again.",
  igdb_not_configured:
    "Game search is unavailable. Type the game's name instead.",
  igdb_unavailable:
    "Game search is unavailable right now. Type the game's name instead.",
  invalid_game_name: "Enter a game name using letters or numbers.",
} as const;
