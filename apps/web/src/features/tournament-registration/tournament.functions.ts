import { redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import * as z from "zod";
import {
  currentSessionRequest,
  eventUnlockHeaders,
  isNativeFormPost,
  setPrivateNoStoreResponse,
} from "../../server/request-boundary.server.js";
import {
  validateEntryInput,
  validateRegisterInput,
  type TournamentMutationResult,
  type ValidatedTournamentInput,
} from "./contracts.js";
import {
  decideEntryOperation,
  deleteEntryOperation,
  eventPageWithNotice,
  registerOperation,
  registrationTeamsOperation,
  tournamentEntriesOperation,
} from "./tournament-operations.server.js";

const slugInputSchema = z.object({ slug: z.string().trim().min(1).max(200) });

export const getTournamentEntries = createServerFn({ method: "GET" })
  .validator(slugInputSchema)
  .handler(async ({ data }) => {
    const request = currentSessionRequest();
    if (request.sessionCookieValue) setPrivateNoStoreResponse();
    return tournamentEntriesOperation(data, {
      api: request.api,
      cookieHeader: request.cookieHeader,
      unlockHeaders: eventUnlockHeaders(data.slug),
    });
  });

export const getRegistrationTeams = createServerFn({ method: "GET" })
  .validator(slugInputSchema)
  .handler(async ({ data }) => {
    setPrivateNoStoreResponse();
    return registrationTeamsOperation(data, currentSessionRequest());
  });

export const registerForTournament = createServerFn({
  method: "POST",
  strict: { input: false },
})
  .validator((input: object | FormData) => validateRegisterInput(input))
  .handler(({ data }) =>
    runChange(data, (value, request) =>
      registerOperation(value, {
        ...request,
        unlockHeaders: eventUnlockHeaders(value.slug),
      }),
    ),
  );

export const withdrawTournamentEntry = createServerFn({
  method: "POST",
  strict: { input: false },
})
  .validator((input: object | FormData) => validateEntryInput(input))
  .handler(({ data }) =>
    runChange(data, (value, request) =>
      deleteEntryOperation(value, "withdrawn", request),
    ),
  );

export const removeTournamentEntry = createServerFn({
  method: "POST",
  strict: { input: false },
})
  .validator((input: object | FormData) => validateEntryInput(input))
  .handler(({ data }) =>
    runChange(data, (value, request) =>
      deleteEntryOperation(value, "removed", request),
    ),
  );

export const approveTournamentEntry = createServerFn({
  method: "POST",
  strict: { input: false },
})
  .validator((input: object | FormData) => validateEntryInput(input))
  .handler(({ data }) =>
    runChange(data, (value, request) =>
      decideEntryOperation(value, "approved", request),
    ),
  );

export const declineTournamentEntry = createServerFn({
  method: "POST",
  strict: { input: false },
})
  .validator((input: object | FormData) => validateEntryInput(input))
  .handler(({ data }) =>
    runChange(data, (value, request) =>
      decideEntryOperation(value, "declined", request),
    ),
  );

// A native form post always redirects, with a notice naming the outcome; an
// enhanced one returns the destination for the client to navigate to.
async function runChange<T>(
  data: ValidatedTournamentInput<T>,
  operation: (
    input: T,
    request: ReturnType<typeof currentSessionRequest>,
  ) => Promise<TournamentMutationResult>,
): Promise<TournamentMutationResult> {
  setPrivateNoStoreResponse();
  const result: TournamentMutationResult = data.valid
    ? await operation(data.value, currentSessionRequest())
    : {
        status: "success",
        redirectTo: data.slug
          ? eventPageWithNotice(data.slug, "failed")
          : "/events?event=failed",
      };
  if (isNativeFormPost()) {
    throw redirect({ href: result.redirectTo, statusCode: 303 });
  }
  return result;
}
