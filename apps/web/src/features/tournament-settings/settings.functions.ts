import { redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import {
  currentSessionRequest,
  isNativeFormPost,
  setPrivateNoStoreResponse,
} from "../../server/request-boundary.server.js";
import type {
  TournamentMutationResult,
  ValidatedTournamentInput,
} from "../tournament-registration/contracts.js";
import {
  type SettingsNotice,
  validateSeedsInput,
  validateSettingsInput,
  validateSlugInput,
  validateStatusInput,
} from "./contracts.js";
import {
  deleteSettingsOperation,
  saveSettingsOperation,
  setSeedsOperation,
  setStatusOperation,
  settingsPageWithNotice,
} from "./settings-operations.server.js";

export const saveTournamentSettings = createServerFn({
  method: "POST",
  strict: { input: false },
})
  .validator((input: object | FormData) => validateSettingsInput(input))
  .handler(({ data }) => runChange(data, saveSettingsOperation));

export const deleteTournamentSettings = createServerFn({
  method: "POST",
  strict: { input: false },
})
  .validator((input: object | FormData) => validateSlugInput(input))
  .handler(({ data }) => runChange(data, deleteSettingsOperation));

export const setTournamentStatus = createServerFn({
  method: "POST",
  strict: { input: false },
})
  .validator((input: object | FormData) => validateStatusInput(input))
  .handler(({ data }) => runChange(data, setStatusOperation));

export const setTournamentSeeds = createServerFn({
  method: "POST",
  strict: { input: false },
})
  .validator((input: object | FormData) => validateSeedsInput(input))
  .handler(({ data }) => runChange(data, setSeedsOperation, "seeds"));

// A native form post always redirects, with a notice naming the outcome; an
// enhanced one returns the destination for the client to navigate to.
async function runChange<T>(
  data: ValidatedTournamentInput<T>,
  operation: (
    input: T,
    request: ReturnType<typeof currentSessionRequest>,
  ) => Promise<TournamentMutationResult>,
  invalidNotice: SettingsNotice = "invalid",
): Promise<TournamentMutationResult> {
  setPrivateNoStoreResponse();
  const result: TournamentMutationResult = data.valid
    ? await operation(data.value, currentSessionRequest())
    : {
        status: "success",
        redirectTo: data.slug
          ? settingsPageWithNotice(data.slug, invalidNotice)
          : "/events?event=failed",
      };
  if (isNativeFormPost()) {
    throw redirect({ href: result.redirectTo, statusCode: 303 });
  }
  return result;
}
