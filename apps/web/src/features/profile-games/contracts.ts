import * as z from "zod";
import {
  noGameChosenMessage,
  otherGameSchema,
  pickedIGDBGameIDsSchema,
} from "../game-picker/contracts.js";

/** The game lists on a profile, in the order the pages show them. */
export const profileGameLists = ["favorite", "like", "want_to_play"] as const;
export type ProfileGameList = (typeof profileGameLists)[number];

export const profileGameListLabels = {
  favorite: "Favorite games",
  like: "Games I like",
  want_to_play: "Want to play",
} as const satisfies Record<ProfileGameList, string>;

/** The API caps favorites at five; the other lists are uncapped. */
export const maximumFavoriteGames = 5;
/** The API adds at most ten games in one request. */
const maximumAddedGames = 10;

const identifierSchema = z.string().trim().min(1).max(200);

export const listedGameDtoSchema = z.object({
  id: identifierSchema,
  name: z.string(),
  slug: identifierSchema,
  cover_url: z.string().optional(),
});

export const profileGameListsDtoSchema = z.object({
  favorite: z.array(listedGameDtoSchema),
  like: z.array(listedGameDtoSchema),
  want_to_play: z.array(listedGameDtoSchema),
});

export type ListedGameDTO = z.output<typeof listedGameDtoSchema>;
export type ProfileGameListsDTO = z.output<typeof profileGameListsDtoSchema>;

const addProfileGamesInputSchema = z
  .object({
    list: z.enum(profileGameLists, "Choose a list."),
    game_ids: z.array(z.uuid("Choose a game from the list.")).max(10),
    igdb_game_ids: pickedIGDBGameIDsSchema,
    other_game: otherGameSchema,
  })
  .superRefine((input, context) => {
    const added =
      input.game_ids.length +
      input.igdb_game_ids.length +
      (input.other_game ? 1 : 0);
    if (added === 0) {
      context.addIssue({
        code: "custom",
        message: noGameChosenMessage,
        path: ["game_ids"],
      });
    } else if (added > maximumAddedGames) {
      context.addIssue({
        code: "custom",
        message: "Add ten games or fewer at a time.",
        path: ["game_ids"],
      });
    }
  });

const listedGameInputSchema = z.object({
  game_id: z.uuid("Reload the page and try again."),
});

const moveProfileGameInputSchema = listedGameInputSchema.extend({
  position: z.coerce
    .number<string>("Reload the page and try again.")
    .int()
    .min(0)
    .max(1000),
});

export type AddProfileGamesInput = z.output<typeof addProfileGamesInputSchema>;
export type ListedGameInput = z.output<typeof listedGameInputSchema>;
export type MoveProfileGameInput = z.output<typeof moveProfileGameInputSchema>;

export type ProfileGamesFieldErrors = Record<string, string[] | undefined>;

export type ValidatedProfileGamesInput<T> =
  | { valid: true; value: T }
  | {
      valid: false;
      message: "Check the highlighted fields and try again.";
      fieldErrors: ProfileGamesFieldErrors;
    };

/** The settings page's game lists: unavailable never fails the page. */
export type ProfileGamesPageResult =
  | {
      status: "ready";
      lists: ProfileGameListsDTO;
      catalog: ListedGameDTO[];
    }
  | { status: "unauthenticated" }
  | { status: "unavailable" };

export type ProfileGamesMutationResult =
  | { status: "success"; redirectTo: string }
  | {
      status: "error";
      message: string;
      fieldErrors?: ProfileGamesFieldErrors;
      notice: "games-failed" | "favorite-add-failed";
    };

export function validateAddProfileGamesInput(
  input: object | FormData,
): ValidatedProfileGamesInput<AddProfileGamesInput> {
  return validationResult(
    addProfileGamesInputSchema.safeParse({
      list: inputValue(input, "list"),
      game_ids: inputValues(input, "game_ids").filter(Boolean),
      igdb_game_ids: inputValues(input, "igdb_game_ids").filter(Boolean),
      other_game: inputValue(input, "other_game"),
    }),
  );
}

export function validateRemoveProfileGameInput(
  input: object | FormData,
): ValidatedProfileGamesInput<ListedGameInput> {
  return validationResult(
    listedGameInputSchema.safeParse({ game_id: inputValue(input, "game_id") }),
  );
}

export function validateMoveProfileGameInput(
  input: object | FormData,
): ValidatedProfileGamesInput<MoveProfileGameInput> {
  return validationResult(
    moveProfileGameInputSchema.safeParse({
      game_id: inputValue(input, "game_id"),
      position: inputValue(input, "position"),
    }),
  );
}

function validationResult<T>(
  parsed: z.ZodSafeParseResult<T>,
): ValidatedProfileGamesInput<T> {
  if (parsed.success) return { valid: true, value: parsed.data };
  const fieldErrors: ProfileGamesFieldErrors = {};
  for (const issue of parsed.error.issues) {
    const field = String(issue.path[0] ?? "form");
    const messages = fieldErrors[field] ?? [];
    if (!messages.includes(issue.message)) messages.push(issue.message);
    fieldErrors[field] = messages;
  }
  return {
    valid: false,
    message: "Check the highlighted fields and try again.",
    fieldErrors,
  };
}

function inputValue(input: object | FormData, field: string): string {
  const value =
    input instanceof FormData
      ? input.get(field)
      : (input as Record<string, unknown>)[field];
  return typeof value === "string" ? value.trim() : "";
}

function inputValues(input: object | FormData, field: string): string[] {
  const values =
    input instanceof FormData
      ? input.getAll(field)
      : (input as Record<string, unknown>)[field];
  return (Array.isArray(values) ? values : [])
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim());
}
