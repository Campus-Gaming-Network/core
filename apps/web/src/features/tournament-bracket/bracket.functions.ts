import { redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import * as z from "zod";
import {
  currentSessionRequest,
  eventUnlockHeaders,
  isNativeFormPost,
  setPrivateNoStoreResponse,
} from "../../server/request-boundary.server.js";
import type { TournamentMutationResult } from "../tournament-registration/contracts.js";
import { validateBracketInput, validateResultInput } from "./contracts.js";
import {
  bracketPageWithNotice,
  generateBracketOperation,
  matchPageWithNotice,
  recordResultOperation,
  tournamentMatchesOperation,
} from "./bracket-operations.server.js";

const slugInputSchema = z.object({ slug: z.string().trim().min(1).max(200) });

export const getTournamentMatches = createServerFn({ method: "GET" })
  .validator(slugInputSchema)
  .handler(async ({ data }) => {
    const request = currentSessionRequest();
    if (request.sessionCookieValue) setPrivateNoStoreResponse();
    return tournamentMatchesOperation(data, {
      api: request.api,
      cookieHeader: request.cookieHeader,
      unlockHeaders: eventUnlockHeaders(data.slug),
    });
  });

export const generateBracket = createServerFn({
  method: "POST",
  strict: { input: false },
})
  .validator((input: object | FormData) => validateBracketInput(input))
  .handler(({ data }) =>
    finish(
      data.valid
        ? generateBracketOperation(data.value, currentSessionRequest())
        : Promise.resolve({
            status: "success",
            redirectTo: "/events?event=failed",
          }),
    ),
  );

export const recordMatchResult = createServerFn({
  method: "POST",
  strict: { input: false },
})
  .validator((input: object | FormData) => validateResultInput(input))
  .handler(({ data }) =>
    finish(
      data.valid
        ? recordResultOperation(data.value, currentSessionRequest())
        : Promise.resolve({
            status: "success",
            redirectTo: data.slug
              ? data.matchID
                ? matchPageWithNotice(data.slug, data.matchID, "invalid")
                : bracketPageWithNotice(data.slug, "invalid")
              : "/events?event=failed",
          }),
    ),
  );

// A native form post always redirects, with a notice naming the outcome; an
// enhanced one returns the destination for the client to navigate to.
async function finish(
  change: Promise<TournamentMutationResult>,
): Promise<TournamentMutationResult> {
  setPrivateNoStoreResponse();
  const result = await change;
  if (isNativeFormPost()) {
    throw redirect({ href: result.redirectTo, statusCode: 303 });
  }
  return result;
}
