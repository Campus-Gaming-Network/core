import { ApiError, type ApiClient } from "../../server/api.server.js";
import { apiErrorReporter } from "../../server/api-error-reporter.server.js";
import { emptyResponseDtoSchema } from "../event-slice/contracts.js";
import {
  tournamentDtoSchema,
  type TournamentMutationResult,
} from "../tournament-registration/contracts.js";
import {
  settingsErrorNotices,
  type SettingsInput,
  type SettingsNotice,
  type SlugInput,
  type StatusInput,
} from "./contracts.js";

type Dependencies = {
  api: ApiClient;
  cookieHeader: string;
  reportError?: (error: unknown) => void;
};

function tournamentPath(slug: string): string {
  return `/events/${encodeURIComponent(slug)}/tournament`;
}

/** The settings page, with a notice naming an outcome. */
export function settingsPageWithNotice(
  slug: string,
  notice: SettingsNotice,
): string {
  return `/events/${encodeURIComponent(slug)}/tournament?settings=${notice}`;
}

/** Creates or replaces the settings. */
export function saveSettingsOperation(
  { slug, settings }: SettingsInput,
  dependencies: Dependencies,
): Promise<TournamentMutationResult> {
  return change(slug, "saved", dependencies, (api, cookieHeader) =>
    api({
      path: tournamentPath(slug),
      method: "PUT",
      cookieHeader,
      cache: "no-store",
      body: settings,
      responseSchema: tournamentDtoSchema,
    }),
  );
}

/** Deletes a draft's settings. */
export function deleteSettingsOperation(
  { slug }: SlugInput,
  dependencies: Dependencies,
): Promise<TournamentMutationResult> {
  return change(slug, "deleted", dependencies, (api, cookieHeader) =>
    api({
      path: tournamentPath(slug),
      method: "DELETE",
      cookieHeader,
      cache: "no-store",
      responseSchema: emptyResponseDtoSchema,
    }),
  );
}

/** Moves the status; the notice names the new status. */
export function setStatusOperation(
  { slug, status }: StatusInput,
  dependencies: Dependencies,
): Promise<TournamentMutationResult> {
  return change(slug, status, dependencies, (api, cookieHeader) =>
    api({
      path: `${tournamentPath(slug)}/status`,
      method: "POST",
      cookieHeader,
      cache: "no-store",
      body: { status },
      responseSchema: tournamentDtoSchema,
    }),
  );
}

async function change(
  slug: string,
  success: SettingsNotice,
  { api, cookieHeader, reportError = defaultErrorReporter }: Dependencies,
  request: (api: ApiClient, cookieHeader: string) => Promise<unknown>,
): Promise<TournamentMutationResult> {
  try {
    await request(api, cookieHeader);
    return {
      status: "success",
      redirectTo: settingsPageWithNotice(slug, success),
    };
  } catch (error) {
    reportError(error);
    const notice =
      error instanceof ApiError ? settingsErrorNotices[error.code] : undefined;
    return {
      status: "success",
      redirectTo: settingsPageWithNotice(slug, notice ?? "failed"),
    };
  }
}

const defaultErrorReporter = apiErrorReporter("Tournament settings");
