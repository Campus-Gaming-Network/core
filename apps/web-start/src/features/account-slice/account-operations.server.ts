import * as z from "zod";
import {
  ApiContractError,
  ApiError,
  safeApiErrorMessage,
  type ApiClient
} from "../../server/api.server.js";
import type { CookieMutation } from "../../server/cookies.server.js";
import {
  accountProfileDtoSchema,
  dashboardEventsDtoSchema,
  followedSchoolsDtoSchema,
  myTeamsDtoSchema,
  type AccountDashboardResult,
  type AccountMutationResult,
  type DeleteAccountInput,
  type UpdateProfileInput
} from "./contracts.js";

type ReadDependencies = {
  api: ApiClient;
  cookieHeader: string;
  reportError?: (error: unknown) => void;
};

type DeleteDependencies = ReadDependencies & {
  sessionCookieName: string;
  applyCookie: (mutation: CookieMutation) => void;
};

const emptyDashboard = {
  upcoming_rsvps: [],
  followed_school_events: []
};

export async function accountDashboardOperation(
  { api, cookieHeader, reportError = defaultErrorReporter }: ReadDependencies
): Promise<AccountDashboardResult> {
  let profile;
  try {
    ({ data: profile } = await api({
      path: "/me",
      cookieHeader,
      cache: "no-store",
      responseSchema: accountProfileDtoSchema
    }));
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      return { status: "unauthenticated" };
    }
    reportError(error);
    return { status: "error", message: "Account details are unavailable." };
  }

  const [dashboardEvents, followedSchools, teams] = await Promise.all([
    safeSecondaryRead(
      () => api({
        path: "/me/events?limit=5",
        cookieHeader,
        cache: "no-store",
        responseSchema: dashboardEventsDtoSchema
      }).then(({ data }) => data),
      emptyDashboard,
      reportError
    ),
    safeSecondaryRead(
      () => api({
        path: "/me/schools",
        cookieHeader,
        cache: "no-store",
        responseSchema: followedSchoolsDtoSchema
      }).then(({ data }) => data.schools),
      [],
      reportError
    ),
    safeSecondaryRead(
      () => api({
        path: "/me/teams?limit=10",
        cookieHeader,
        cache: "no-store",
        responseSchema: myTeamsDtoSchema
      }).then(({ data }) => data.teams),
      [],
      reportError
    )
  ]);

  return {
    status: "found",
    profile,
    dashboardEvents: dashboardEvents.data,
    followedSchools: followedSchools.data,
    teams: teams.data,
    unavailable: {
      dashboardEvents: dashboardEvents.unavailable,
      followedSchools: followedSchools.unavailable,
      teams: teams.unavailable
    }
  };
}

export async function updateProfileOperation(
  input: UpdateProfileInput,
  { api, cookieHeader, reportError = defaultErrorReporter }: ReadDependencies
): Promise<AccountMutationResult> {
  try {
    await api({
      path: "/me",
      method: "PATCH",
      cookieHeader,
      body: input,
      responseSchema: accountProfileDtoSchema
    });
    return {
      status: "success",
      message: "Profile updated.",
      redirectTo: "/account?account=profile-updated"
    };
  } catch (error) {
    reportError(error);
    return { status: "error", message: safeApiErrorMessage(error) };
  }
}

export async function deleteAccountOperation(
  _input: DeleteAccountInput,
  {
    api,
    cookieHeader,
    sessionCookieName,
    applyCookie,
    reportError = defaultErrorReporter
  }: DeleteDependencies
): Promise<AccountMutationResult> {
  try {
    await api({
      path: "/me",
      method: "DELETE",
      cookieHeader,
      responseSchema: z.undefined()
    });
  } catch (error) {
    reportError(error);
    return { status: "error", message: safeApiErrorMessage(error) };
  }

  applyCookie({
    kind: "delete",
    name: sessionCookieName,
    options: { path: "/" }
  });
  return {
    status: "success",
    message: "Account deleted.",
    redirectTo: "/?account=deleted"
  };
}

async function safeSecondaryRead<T>(
  read: () => Promise<T>,
  fallback: T,
  reportError: (error: unknown) => void
) {
  try {
    return { data: await read(), unavailable: false };
  } catch (error) {
    reportError(error);
    return { data: fallback, unavailable: true };
  }
}

function defaultErrorReporter(error: unknown): void {
  if (error instanceof ApiContractError) {
    console.error("Account response contract violation", {
      path: error.path,
      issues: error.issues
    });
  } else if (!(error instanceof ApiError)) {
    console.error("Account request failed");
  }
}
