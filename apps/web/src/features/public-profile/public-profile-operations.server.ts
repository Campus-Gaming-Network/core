import * as z from "zod";
import {
  ApiContractError,
  ApiError,
  safeApiErrorMessage,
  type ApiClient
} from "../../server/api.server.js";
import { optionalViewerProfile } from "../../server/viewer.server.js";
import {
  publicProfileDtoSchema,
  type PublicProfileInput,
  type PublicProfileDTO,
  type PublicProfilePageResult,
  type ReportUserInput,
  type ReportUserResult
} from "./contracts.js";

type Dependencies = {
  api: ApiClient;
  cookieHeader: string;
  sessionCookieValue?: string;
  reportError?: (error: unknown) => void;
};

type ReportDependencies = Pick<
  Dependencies,
  "api" | "cookieHeader" | "reportError"
>;

const idResponseSchema = z.object({ id: z.string().trim().min(1) });

const unavailableResult = {
  status: "error" as const,
  message: "We could not load this profile. Please try again." as const
};

export async function getPublicProfilePageOperation(
  { id }: PublicProfileInput,
  {
    api,
    cookieHeader,
    sessionCookieValue,
    reportError = defaultErrorReporter
  }: Dependencies
): Promise<PublicProfilePageResult> {
  let profile: PublicProfileDTO;
  try {
    const result = await api({
      path: `/users/${encodeURIComponent(id)}`,
      cache: "no-store",
      responseSchema: publicProfileDtoSchema
    });
    profile = result.data;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return { status: "not_found" };
    }
    reportError(error);
    return unavailableResult;
  }

  // Resolve the target before viewer state so a real upstream 404 cannot be
  // masked by an unrelated /me outage.
  try {
    const viewer = await optionalViewerProfile({
      api,
      cookieHeader,
      sessionCookieValue
    });
    return {
      status: "found",
      profile,
      viewer: !viewer ? "anonymous" : viewer.id === profile.id ? "self" : "other"
    };
  } catch (error) {
    reportError(error);
    return unavailableResult;
  }
}

export async function reportUserOperation(
  { userID, reason }: ReportUserInput,
  {
    api,
    cookieHeader,
    reportError = defaultErrorReporter
  }: ReportDependencies
): Promise<ReportUserResult> {
  try {
    await api({
      path: `/users/${encodeURIComponent(userID)}/report`,
      method: "POST",
      cookieHeader,
      body: { reason },
      cache: "no-store",
      responseSchema: idResponseSchema
    });
    return { status: "success", message: "Report submitted for review." };
  } catch (error) {
    reportError(error);
    return { status: "error", message: safeApiErrorMessage(error) };
  }
}

function defaultErrorReporter(error: unknown): void {
  if (error instanceof ApiContractError) {
    console.error("API response contract violation", {
      path: error.path,
      issues: error.issues
    });
  } else if (!(error instanceof ApiError)) {
    console.error("Public profile request failed");
  }
}
