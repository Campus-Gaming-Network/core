import * as z from "zod";
import {
  ApiContractError,
  ApiError,
  safeApiErrorMessage,
  type ApiClient,
} from "../../server/api.server.js";
import type { CookieMutation } from "../../server/cookies.server.js";
import {
  withBundledSchoolLogo,
  withHostSchoolLogo,
} from "../school-slice/school-logos.server.js";
import {
  accountProfileDtoSchema,
  dashboardEventLimit,
  dashboardEventsDtoSchema,
  followedSchoolsDtoSchema,
  myTeamsDtoSchema,
  sidebarFollowedSchoolLimit,
  type AccountDashboardResult,
  type DirectorySidebarResult,
  type AccountMutationResult,
  type AccountProfileResult,
  type DeleteAccountInput,
  type UpdateProfileInput,
} from "./contracts.js";
import {
  securityFailureNotice,
  securityNotices,
  type ChangeEmailInput,
  type ChangePasswordInput,
  type ConfirmEmailChangeInput,
  type SecurityForm,
  type SecurityNoticeKey,
} from "./security.js";

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
  followed_school_events: [],
  interested_events: [],
};

export async function accountProfileOperation({
  api,
  cookieHeader,
  reportError = defaultErrorReporter,
}: ReadDependencies): Promise<AccountProfileResult> {
  try {
    const { data: profile } = await api({
      path: "/me",
      cookieHeader,
      cache: "no-store",
      responseSchema: accountProfileDtoSchema,
    });
    return { status: "found", profile };
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      return { status: "unauthenticated" };
    }
    reportError(error);
    return { status: "error", message: "Account details are unavailable." };
  }
}

export async function accountDashboardOperation(
  dependencies: ReadDependencies,
): Promise<AccountDashboardResult> {
  const {
    api,
    cookieHeader,
    reportError = defaultErrorReporter,
  } = dependencies;
  const loaded = await accountProfileOperation(dependencies);
  if (loaded.status !== "found") return loaded;
  const { profile } = loaded;

  const [dashboardEvents, followedSchools, teams] = await Promise.all([
    safeSecondaryRead(
      () =>
        api({
          path: `/me/events?limit=${dashboardEventLimit}`,
          cookieHeader,
          cache: "no-store",
          responseSchema: dashboardEventsDtoSchema,
        }).then(({ data }) => ({
          upcoming_rsvps: data.upcoming_rsvps.map(withHostSchoolLogo),
          followed_school_events:
            data.followed_school_events.map(withHostSchoolLogo),
          interested_events: data.interested_events.map(withHostSchoolLogo),
        })),
      emptyDashboard,
      reportError,
    ),
    safeSecondaryRead(
      () =>
        api({
          path: "/me/schools",
          cookieHeader,
          cache: "no-store",
          responseSchema: followedSchoolsDtoSchema,
        }).then(({ data }) => data.schools.map(withBundledSchoolLogo)),
      [],
      reportError,
    ),
    safeSecondaryRead(
      () =>
        api({
          path: "/me/teams?limit=25",
          cookieHeader,
          cache: "no-store",
          responseSchema: myTeamsDtoSchema,
        }).then(({ data }) => data.teams),
      [],
      reportError,
    ),
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
      teams: teams.unavailable,
    },
  };
}

/**
 * The viewer's home school and first followed schools for the directory
 * sidebar, from the same `/me` and `/me/schools` reads as the account page.
 * Any failure leaves the sidebar with its section links only.
 */
export async function directorySidebarOperation(
  dependencies: ReadDependencies,
): Promise<DirectorySidebarResult> {
  const {
    api,
    cookieHeader,
    reportError = defaultErrorReporter,
  } = dependencies;
  const [loaded, followed] = await Promise.all([
    accountProfileOperation(dependencies),
    safeSecondaryRead(
      () =>
        api({
          path: "/me/schools",
          cookieHeader,
          cache: "no-store",
          responseSchema: followedSchoolsDtoSchema,
        }).then(({ data }) => data.schools),
      [],
      // A visitor's 401 is not a failure worth reporting.
      (error) => {
        if (!(error instanceof ApiError && error.status === 401)) {
          reportError(error);
        }
      },
    ),
  ]);
  if (loaded.status === "unauthenticated") return { status: "visitor" };
  if (loaded.status !== "found" || followed.unavailable) {
    return { status: "unavailable" };
  }

  const { home_school: homeSchool } = loaded.profile;
  return {
    status: "found",
    ...(homeSchool ? { homeSchool: withBundledSchoolLogo(homeSchool) } : {}),
    followedSchools: followed.data
      .slice(0, sidebarFollowedSchoolLimit)
      .map(withBundledSchoolLogo),
    moreFollowedSchools: followed.data.length > sidebarFollowedSchoolLimit,
  };
}

export async function updateProfileOperation(
  input: UpdateProfileInput,
  { api, cookieHeader, reportError = defaultErrorReporter }: ReadDependencies,
): Promise<AccountMutationResult> {
  // The API holds a Discord username as one more social link.
  const {
    discord_username: discordUsername,
    social_links: links,
    ...fields
  } = input;
  try {
    await api({
      path: "/me",
      method: "PATCH",
      cookieHeader,
      body: {
        ...fields,
        social_links: [
          ...links,
          ...(discordUsername
            ? [{ kind: "discord", username: discordUsername }]
            : []),
        ],
      },
      responseSchema: accountProfileDtoSchema,
    });
    return {
      status: "success",
      message: "Profile updated.",
      redirectTo: "/settings/profile?settings=profile-updated",
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
    reportError = defaultErrorReporter,
  }: DeleteDependencies,
): Promise<AccountMutationResult> {
  try {
    await api({
      path: "/me",
      method: "DELETE",
      cookieHeader,
      responseSchema: z.undefined(),
    });
  } catch (error) {
    reportError(error);
    return { status: "error", message: safeApiErrorMessage(error) };
  }

  applyCookie({
    kind: "delete",
    name: sessionCookieName,
    options: { path: "/" },
  });
  return {
    status: "success",
    message: "Account deleted.",
    redirectTo: "/?account=deleted",
  };
}

async function safeSecondaryRead<T>(
  read: () => Promise<T>,
  fallback: T,
  reportError: (error: unknown) => void,
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
      issues: error.issues,
    });
  } else if (!(error instanceof ApiError)) {
    console.error("Account request failed");
  }
}

/** A password or email change: where to go next, or the notice to show. */
export type SecurityChangeResult =
  | { status: "success"; message: string; redirectTo: string }
  | {
      status: "error";
      message: string;
      notice: SecurityNoticeKey;
      fieldErrors?: Record<string, string[] | undefined>;
    };

// POST /me/email answers 202 with a status; POST /me/password answers 204.
const acceptedResponseSchema = z.object({ status: z.string() });

export async function changePasswordOperation(
  input: ChangePasswordInput,
  { api, cookieHeader, reportError = defaultErrorReporter }: ReadDependencies,
): Promise<SecurityChangeResult> {
  try {
    await api({
      path: "/me/password",
      method: "POST",
      cookieHeader,
      body: input,
      responseSchema: z.undefined(),
    });
    return {
      status: "success",
      message: securityNotices["password-changed"].message,
      redirectTo: "/settings/security?security=password-changed",
    };
  } catch (error) {
    return securityFailure("password", error, reportError);
  }
}

export async function changeEmailOperation(
  input: ChangeEmailInput,
  { api, cookieHeader, reportError = defaultErrorReporter }: ReadDependencies,
): Promise<SecurityChangeResult> {
  try {
    await api({
      path: "/me/email",
      method: "POST",
      cookieHeader,
      body: input,
      responseSchema: acceptedResponseSchema,
    });
    return {
      status: "success",
      message: securityNotices["email-sent"].message,
      redirectTo: "/settings/security?security=email-sent",
    };
  } catch (error) {
    return securityFailure("email", error, reportError);
  }
}

/**
 * Applies an email change from the link sent to the new address. It sends no
 * session cookie: the link may open anywhere, and the token alone decides.
 */
export async function confirmEmailChangeOperation(
  input: ConfirmEmailChangeInput,
  {
    api,
    reportError = defaultErrorReporter,
  }: Omit<ReadDependencies, "cookieHeader">,
): Promise<{ status: "success" } | { status: "error"; message: string }> {
  try {
    await api({
      path: "/auth/confirm-email-change",
      method: "POST",
      body: input,
      responseSchema: acceptedResponseSchema,
    });
    return { status: "success" };
  } catch (error) {
    if (!(error instanceof ApiError) || error.status >= 500) reportError(error);
    return {
      status: "error",
      message:
        error instanceof ApiError && error.code === "rate_limited"
          ? securityNotices["rate-limited"].message
          : "That link is invalid or has expired.",
    };
  }
}

function securityFailure(
  form: SecurityForm,
  error: unknown,
  reportError: (error: unknown) => void,
): SecurityChangeResult {
  const code = error instanceof ApiError ? error.code : undefined;
  if (!(error instanceof ApiError) || error.status >= 500) reportError(error);
  const notice = securityFailureNotice(form, code);
  const entry: { message: string; field?: string } = securityNotices[notice];
  return {
    status: "error",
    message: entry.message,
    notice,
    ...(entry.field ? { fieldErrors: { [entry.field]: [entry.message] } } : {}),
  };
}
