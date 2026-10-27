import { ApiError, type ApiClient } from "../../server/api.server.js";
import { apiErrorReporter } from "../../server/api-error-reporter.server.js";
import type { TournamentMutationResult } from "../tournament-registration/contracts.js";
import {
  bracketErrorNotices,
  tournamentMatchesResponseDtoSchema,
  type BracketInput,
  type BracketNotice,
  type BracketResult,
  type ResultInput,
} from "./contracts.js";

type Dependencies = {
  api: ApiClient;
  cookieHeader: string;
  unlockHeaders?: HeadersInit;
  reportError?: (error: unknown) => void;
};

function tournamentPath(slug: string): string {
  return `/events/${encodeURIComponent(slug)}/tournament`;
}

/** The bracket page, with a notice naming an outcome. */
export function bracketPageWithNotice(
  slug: string,
  notice: BracketNotice,
): string {
  return `/events/${encodeURIComponent(slug)}/bracket?bracket=${notice}`;
}

/** A match's page, with a notice naming a result's outcome. */
export function matchPageWithNotice(
  slug: string,
  matchID: string,
  notice: BracketNotice,
): string {
  return `/events/${encodeURIComponent(slug)}/matches/${encodeURIComponent(matchID)}?bracket=${notice}`;
}

/** The tournament settings page, where the bracket is generated from. */
export function settingsPageWithBracketNotice(
  slug: string,
  notice: BracketNotice,
): string {
  return `/events/${encodeURIComponent(slug)}/tournament?bracket=${notice}`;
}

/** The bracket by round and position; empty until organizers generate it. */
export async function tournamentMatchesOperation(
  { slug }: { slug: string },
  {
    api,
    cookieHeader,
    unlockHeaders,
    reportError = defaultErrorReporter,
  }: Dependencies,
): Promise<BracketResult> {
  try {
    const { data } = await api({
      path: `${tournamentPath(slug)}/matches`,
      cookieHeader,
      headers: unlockHeaders,
      cache: "no-store",
      responseSchema: tournamentMatchesResponseDtoSchema,
    });
    return { status: "ready", matches: data.matches };
  } catch (error) {
    reportError(error);
    return { status: "unavailable" };
  }
}

/**
 * Generates, or regenerates, the bracket. Success shows the bracket; a
 * refusal goes back to the settings page it was asked from.
 */
export async function generateBracketOperation(
  { slug }: BracketInput,
  { api, cookieHeader, reportError = defaultErrorReporter }: Dependencies,
): Promise<TournamentMutationResult> {
  try {
    await api({
      path: `${tournamentPath(slug)}/bracket`,
      method: "POST",
      cookieHeader,
      cache: "no-store",
      responseSchema: tournamentMatchesResponseDtoSchema,
    });
    return {
      status: "success",
      redirectTo: bracketPageWithNotice(slug, "generated"),
    };
  } catch (error) {
    reportError(error);
    return {
      status: "success",
      redirectTo: settingsPageWithBracketNotice(slug, refusal(error)),
    };
  }
}

/** Enters or corrects a match's result, or records a walkover. */
export async function recordResultOperation(
  input: ResultInput,
  { api, cookieHeader, reportError = defaultErrorReporter }: Dependencies,
): Promise<TournamentMutationResult> {
  try {
    await api({
      path: `${tournamentPath(input.slug)}/matches/${encodeURIComponent(input.match_id)}/result`,
      method: "POST",
      cookieHeader,
      cache: "no-store",
      body: input.walkover
        ? { winner_entry_id: input.winner_entry_id, walkover: true }
        : { winner_entry_id: input.winner_entry_id, scores: input.scores },
      responseSchema: tournamentMatchesResponseDtoSchema,
    });
    return {
      status: "success",
      redirectTo: matchPageWithNotice(input.slug, input.match_id, "saved"),
    };
  } catch (error) {
    reportError(error);
    return {
      status: "success",
      redirectTo: matchPageWithNotice(
        input.slug,
        input.match_id,
        refusal(error),
      ),
    };
  }
}

function refusal(error: unknown): BracketNotice {
  return (
    (error instanceof ApiError ? bracketErrorNotices[error.code] : undefined) ??
    "failed"
  );
}

const defaultErrorReporter = apiErrorReporter("Tournament bracket");
