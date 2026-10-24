import * as z from "zod";
import {
  ApiError,
  safeApiErrorMessage,
  type ApiClient,
} from "../../server/api.server.js";
import { apiErrorReporter } from "../../server/api-error-reporter.server.js";
import {
  listedGameDtoSchema,
  profileGameListsDtoSchema,
  type AddProfileGamesInput,
  type ListedGameInput,
  type MoveProfileGameInput,
  type ProfileGamesMutationResult,
  type ProfileGamesPageResult,
} from "./contracts.js";

type Dependencies = {
  api: ApiClient;
  cookieHeader: string;
  reportError?: (error: unknown) => void;
};

const catalogResponseSchema = z.object({
  games: z.array(listedGameDtoSchema),
});

/** Where a change returns: the game lists on the profile settings page. */
const updatedDestination = "/settings/profile?settings=games-updated#games";

/** The viewer's game lists and the catalog the add forms offer. */
export async function profileGamesPageOperation({
  api,
  cookieHeader,
  reportError = defaultErrorReporter,
}: Dependencies): Promise<ProfileGamesPageResult> {
  try {
    const [lists, catalog] = await Promise.all([
      api({
        path: "/me/games",
        cookieHeader,
        cache: "no-store",
        responseSchema: profileGameListsDtoSchema,
      }),
      api({
        path: "/games",
        cache: "no-store",
        responseSchema: catalogResponseSchema,
      }),
    ]);
    return {
      status: "ready",
      lists: lists.data,
      catalog: catalog.data.games,
    };
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      return { status: "unauthenticated" };
    }
    reportError(error);
    return { status: "unavailable" };
  }
}

export function addProfileGamesOperation(
  input: AddProfileGamesInput,
  dependencies: Dependencies,
): Promise<ProfileGamesMutationResult> {
  return profileGamesMutation(dependencies, {
    path: "/me/games",
    method: "POST",
    body: input,
  });
}

export function removeProfileGameOperation(
  { game_id }: ListedGameInput,
  dependencies: Dependencies,
): Promise<ProfileGamesMutationResult> {
  return profileGamesMutation(dependencies, {
    path: `/me/games/${encodeURIComponent(game_id)}`,
    method: "DELETE",
  });
}

export function moveProfileGameOperation(
  { game_id, position }: MoveProfileGameInput,
  dependencies: Dependencies,
): Promise<ProfileGamesMutationResult> {
  return profileGamesMutation(dependencies, {
    path: `/me/games/${encodeURIComponent(game_id)}/position`,
    method: "POST",
    body: { position },
  });
}

async function profileGamesMutation(
  { api, cookieHeader, reportError = defaultErrorReporter }: Dependencies,
  request: { path: string; method: "POST" | "DELETE"; body?: unknown },
): Promise<ProfileGamesMutationResult> {
  try {
    await api({
      ...request,
      cookieHeader,
      cache: "no-store",
      responseSchema: profileGameListsDtoSchema,
    });
    return { status: "success", redirectTo: updatedDestination };
  } catch (error) {
    reportError(error);
    const favoritesFull =
      error instanceof ApiError && error.code === "favorite_games_full";
    return {
      status: "error",
      message: safeProfileGamesMessage(error),
      notice: favoritesFull ? "favorite-add-failed" : "games-failed",
    };
  }
}

export function safeProfileGamesMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const messages: Record<string, string> = {
      favorite_games_full:
        "You can list five favorite games. Remove one before you add another.",
      listed_game_not_found:
        "That game is no longer in your lists. Reload the page.",
    };
    const message = messages[error.code];
    if (message) return message;
  }
  return safeApiErrorMessage(error);
}

const defaultErrorReporter = apiErrorReporter("Profile games");
