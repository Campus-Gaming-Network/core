import {
  ApiContractError,
  ApiError,
  type ApiClient
} from "../../server/api.server.js";
import {
  emptyResponseDtoSchema,
  type SchoolFollowInput,
  type SchoolFollowRedirectResult
} from "./contracts.js";

type Dependencies = {
  api: ApiClient;
  cookieHeader: string;
  reportError?: (error: unknown) => void;
};

export async function followSchoolOperation(
  input: SchoolFollowInput,
  dependencies: Dependencies
): Promise<SchoolFollowRedirectResult> {
  return schoolFollowMutation(input, "POST", "added", dependencies);
}

export async function unfollowSchoolOperation(
  input: SchoolFollowInput,
  dependencies: Dependencies
): Promise<SchoolFollowRedirectResult> {
  return schoolFollowMutation(input, "DELETE", "removed", dependencies);
}

async function schoolFollowMutation(
  { school_id, slug }: SchoolFollowInput,
  method: "POST" | "DELETE",
  successNotice: "added" | "removed",
  {
    api,
    cookieHeader,
    reportError = defaultErrorReporter
  }: Dependencies
): Promise<SchoolFollowRedirectResult> {
  try {
    // The Go API derives the user from the forwarded request session and
    // remains authoritative for authentication and school validity.
    await api({
      path: `/schools/${encodeURIComponent(school_id)}/follow`,
      method,
      cookieHeader,
      cache: "no-store",
      responseSchema: emptyResponseDtoSchema
    });
    return {
      status: "success",
      redirectTo: `/schools/${encodeURIComponent(slug)}?follow=${successNotice}`
    };
  } catch (error) {
    reportError(error);
    return {
      status: "success",
      redirectTo: schoolFollowErrorDestination(error, slug)
    };
  }
}

export function schoolFollowErrorDestination(
  error: unknown,
  slug: string
): string {
  if (error instanceof ApiError && error.status === 401) {
    const next = `/schools/${encodeURIComponent(slug)}`;
    return `/login?next=${encodeURIComponent(next)}`;
  }
  return `/schools/${encodeURIComponent(slug)}?follow=failed`;
}

function defaultErrorReporter(error: unknown): void {
  if (error instanceof ApiContractError) {
    console.error("School follow response contract violation", {
      path: error.path,
      issues: error.issues
    });
  } else if (!(error instanceof ApiError)) {
    console.error("School follow request failed");
  }
}
