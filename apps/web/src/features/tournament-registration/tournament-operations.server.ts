import * as z from "zod";
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
  type TournamentEntriesResult,
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

export function eventPageWithNotice(
  slug: string,
  notice: TournamentNotice,
): string {
  return `/events/${encodeURIComponent(slug)}?tournament=${notice}#registration`;
}

export async function tournamentEntriesOperation(
  { slug }: { slug: string },
  {
    api,
    cookieHeader,
    unlockHeaders,
    reportError = defaultErrorReporter,
  }: Dependencies,
): Promise<TournamentEntriesResult> {
  try {
    const { data } = await api({
      path: `${tournamentPath(slug)}/entries`,
      cookieHeader,
      headers: unlockHeaders,
      cache: "no-store",
      responseSchema: tournamentEntriesResponseDtoSchema,
    });
    return {
      status: "ready",
      items: data.entries,
      requests: data.requests ?? [],
    };
  } catch (error) {
    reportError(error);
    return { status: "unavailable" };
  }
}

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
  return change(slug, "registered", dependencies, async (api, headers) => {
    const { data } = await api({
      path: `${tournamentPath(slug)}/entries`,
      method: "POST",
      body: team_slug ? { team_slug, roster } : {},
      ...headers,
      responseSchema: tournamentEntryDtoSchema,
    });
    return data.status === "pending" ? "requested" : undefined;
  });
}

export function decideEntryOperation(
  { slug, entry_id }: TournamentEntryInput,
  decision: "approved" | "declined",
  dependencies: Dependencies,
): Promise<TournamentMutationResult> {
  return change(slug, decision, dependencies, async (api, headers) => {
    await api({
      path: `${tournamentPath(slug)}/entries/${encodeURIComponent(entry_id)}/${decision === "approved" ? "approve" : "decline"}`,
      method: "POST",
      ...headers,
      responseSchema: decisionResponseDtoSchema,
    });
    return undefined;
  });
}

export function deleteEntryOperation(
  { slug, entry_id }: TournamentEntryInput,
  outcome: "withdrawn" | "removed",
  dependencies: Dependencies,
): Promise<TournamentMutationResult> {
  return change(slug, outcome, dependencies, async (api, headers) => {
    await api({
      path: `${tournamentPath(slug)}/entries/${encodeURIComponent(entry_id)}`,
      method: "DELETE",
      ...headers,
      responseSchema: emptyResponseDtoSchema,
    });
    return undefined;
  });
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
  ) => Promise<TournamentNotice | undefined>,
): Promise<TournamentMutationResult> {
  try {
    const notice = await request(api, {
      cookieHeader,
      headers: unlockHeaders,
      cache: "no-store",
    });
    return {
      status: "success",
      redirectTo: eventPageWithNotice(slug, notice ?? success),
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

// A decline answers with the entry's ID and new status only.
const decisionResponseDtoSchema = z.object({
  id: z.uuid(),
  status: z.enum(["registered", "declined"]),
});

const defaultErrorReporter = apiErrorReporter("Tournament registration");
