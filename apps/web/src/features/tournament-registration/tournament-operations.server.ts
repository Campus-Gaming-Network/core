import { ApiError, type ApiClient } from "../../server/api.server.js";
import { apiErrorReporter } from "../../server/api-error-reporter.server.js";
import { emptyResponseDtoSchema } from "../event-slice/contracts.js";
import {
  registrationTeamsResponseDtoSchema,
  tournamentEntriesResponseDtoSchema,
  tournamentEntryDtoSchema,
  tournamentErrorNotices,
  type RegisterInput,
  type RegistrationTeamDTO,
  type TournamentEntryDTO,
  type TournamentEntryInput,
  type TournamentListResult,
  type TournamentMutationResult,
  type TournamentNotice,
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

/** The event page, with a notice naming a registration outcome. */
export function eventPageWithNotice(
  slug: string,
  notice: TournamentNotice,
): string {
  return `/events/${encodeURIComponent(slug)}?tournament=${notice}#registration`;
}

/** The tournament's active entries in seed order. */
export async function tournamentEntriesOperation(
  { slug }: { slug: string },
  {
    api,
    cookieHeader,
    unlockHeaders,
    reportError = defaultErrorReporter,
  }: Dependencies,
): Promise<TournamentListResult<TournamentEntryDTO>> {
  try {
    const { data } = await api({
      path: `${tournamentPath(slug)}/entries`,
      cookieHeader,
      headers: unlockHeaders,
      cache: "no-store",
      responseSchema: tournamentEntriesResponseDtoSchema,
    });
    return { status: "ready", items: data.entries };
  } catch (error) {
    reportError(error);
    return { status: "unavailable" };
  }
}

/** The teams the viewer owns or captains, for a team registration. */
export async function registrationTeamsOperation(
  { slug }: { slug: string },
  { api, cookieHeader, reportError = defaultErrorReporter }: Dependencies,
): Promise<TournamentListResult<RegistrationTeamDTO>> {
  try {
    const { data } = await api({
      path: `${tournamentPath(slug)}/my-teams`,
      cookieHeader,
      cache: "no-store",
      responseSchema: registrationTeamsResponseDtoSchema,
    });
    return { status: "ready", items: data.teams };
  } catch (error) {
    reportError(error);
    return { status: "unavailable" };
  }
}

export function registerOperation(
  { slug, team_slug, roster }: RegisterInput,
  dependencies: Dependencies,
): Promise<TournamentMutationResult> {
  return change(slug, "registered", dependencies, (api, headers) =>
    api({
      path: `${tournamentPath(slug)}/entries`,
      method: "POST",
      body: team_slug ? { team_slug, roster } : {},
      ...headers,
      responseSchema: tournamentEntryDtoSchema,
    }),
  );
}

/** Withdraws the viewer's entry, or removes one for an organizer. */
export function deleteEntryOperation(
  { slug, entry_id }: TournamentEntryInput,
  outcome: "withdrawn" | "removed",
  dependencies: Dependencies,
): Promise<TournamentMutationResult> {
  return change(slug, outcome, dependencies, (api, headers) =>
    api({
      path: `${tournamentPath(slug)}/entries/${encodeURIComponent(entry_id)}`,
      method: "DELETE",
      ...headers,
      responseSchema: emptyResponseDtoSchema,
    }),
  );
}

async function change(
  slug: string,
  success: TournamentNotice,
  {
    api,
    cookieHeader,
    unlockHeaders,
    reportError = defaultErrorReporter,
  }: Dependencies,
  request: (
    api: ApiClient,
    headers: {
      cookieHeader: string;
      headers?: HeadersInit;
      cache: "no-store";
    },
  ) => Promise<unknown>,
): Promise<TournamentMutationResult> {
  try {
    await request(api, {
      cookieHeader,
      headers: unlockHeaders,
      cache: "no-store",
    });
    return {
      status: "success",
      redirectTo: eventPageWithNotice(slug, success),
    };
  } catch (error) {
    reportError(error);
    const notice =
      error instanceof ApiError
        ? tournamentErrorNotices[error.code]
        : undefined;
    return {
      status: "success",
      redirectTo: eventPageWithNotice(slug, notice ?? "failed"),
    };
  }
}

const defaultErrorReporter = apiErrorReporter("Tournament registration");
