import { redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import {
  currentSessionRequest,
  isNativeFormPost,
  setPrivateNoStoreResponse,
} from "../../server/request-boundary.server.js";
import {
  validateAddProfileGamesInput,
  validateMoveProfileGameInput,
  validateRemoveProfileGameInput,
  type ProfileGamesMutationResult,
  type ValidatedProfileGamesInput,
} from "./contracts.js";
import {
  addProfileGamesOperation,
  moveProfileGameOperation,
  profileGamesPageOperation,
  removeProfileGameOperation,
} from "./profile-games-operations.server.js";

export const getProfileGames = createServerFn({ method: "GET" }).handler(
  async () => {
    const request = currentSessionRequest();
    setPrivateNoStoreResponse();
    if (!request.sessionCookieValue)
      return { status: "unauthenticated" as const };
    return profileGamesPageOperation(request);
  },
);

export const addProfileGames = createServerFn({
  method: "POST",
  strict: { input: false },
})
  .validator((input: object | FormData) => validateAddProfileGamesInput(input))
  .handler(({ data }) => runMutation(data, addProfileGamesOperation));

export const removeProfileGame = createServerFn({
  method: "POST",
  strict: { input: false },
})
  .validator((input: object | FormData) =>
    validateRemoveProfileGameInput(input),
  )
  .handler(({ data }) => runMutation(data, removeProfileGameOperation));

export const moveProfileGame = createServerFn({
  method: "POST",
  strict: { input: false },
})
  .validator((input: object | FormData) => validateMoveProfileGameInput(input))
  .handler(({ data }) => runMutation(data, moveProfileGameOperation));

// A native form post always redirects back to the settings page, with a
// notice that names the outcome; an enhanced one returns the result.
async function runMutation<T>(
  data: ValidatedProfileGamesInput<T>,
  operation: (
    input: T,
    dependencies: ReturnType<typeof currentSessionRequest>,
  ) => Promise<ProfileGamesMutationResult>,
): Promise<ProfileGamesMutationResult> {
  setPrivateNoStoreResponse();
  const nativeForm = isNativeFormPost();
  const result: ProfileGamesMutationResult = data.valid
    ? await operation(data.value, currentSessionRequest())
    : {
        status: "error",
        message: data.message,
        fieldErrors: data.fieldErrors,
        notice: "games-failed",
      };
  if (nativeForm) {
    throw redirect({
      href:
        result.status === "success"
          ? result.redirectTo
          : `/settings/profile?settings=${result.notice}#games`,
      statusCode: 303,
    });
  }
  return result;
}
