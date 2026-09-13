import * as z from "zod";
import { safeLocalPath } from "../../safe-local-path.js";
import {
  ApiContractError,
  ApiError,
  safeApiErrorMessage,
  type ApiClient
} from "../../server/api.server.js";
import {
  configuredCookieDeletion,
  mirroredSessionCookieMutation,
  type CookieMutation
} from "../../server/cookies.server.js";
import {
  optionalViewerProfile,
  profileDtoSchema
} from "../../server/viewer.server.js";
import type {
  EventViewerSessionResult,
  LoginInput,
  LoginResult,
  NavigationSessionDTO
} from "./contracts.js";

type Dependencies = {
  api: ApiClient;
  cookieHeader: string;
  sessionCookieValue?: string;
  sessionCookieName: string;
  applyCookie: (mutation: CookieMutation) => void;
  reportError?: (error: unknown) => void;
};

export type LogoutResult = {
  status: "success";
  redirectTo: "/";
};

export async function getNavigationSessionOperation({
  api,
  cookieHeader,
  sessionCookieValue
}: Pick<
  Dependencies,
  "api" | "cookieHeader" | "sessionCookieValue"
>): Promise<NavigationSessionDTO> {
  if (!sessionCookieValue) {
    return { authenticated: false };
  }

  try {
    const profile = await optionalViewerProfile({
      api,
      cookieHeader,
      sessionCookieValue
    });
    return { authenticated: profile !== null };
  } catch {
    // Navigation is decorative. Authenticated loaders can surface outages, but
    // the public shell must remain usable when /me is unavailable.
    return { authenticated: false };
  }
}

export async function getEventViewerSessionOperation({
  api,
  cookieHeader,
  sessionCookieValue,
  reportError = defaultErrorReporter
}: Pick<
  Dependencies,
  "api" | "cookieHeader" | "sessionCookieValue" | "reportError"
>): Promise<EventViewerSessionResult> {
  if (!sessionCookieValue) {
    return { status: "unauthenticated", authenticated: false };
  }

  try {
    const profile = await optionalViewerProfile({
      api,
      cookieHeader,
      sessionCookieValue
    });
    return profile
      ? { status: "authenticated", authenticated: true }
      : { status: "unauthenticated", authenticated: false };
  } catch (error) {
    reportError(error);
    return {
      status: "unavailable",
      message: "We could not verify your session. Please try again."
    };
  }
}

export async function loginOperation(
  input: LoginInput,
  {
    api,
    sessionCookieName,
    applyCookie,
    reportError = defaultErrorReporter
  }: Omit<Dependencies, "cookieHeader">
): Promise<LoginResult> {
  try {
    const { response } = await api({
      path: "/auth/login",
      method: "POST",
      body: { email: input.email, password: input.password },
      responseSchema: profileDtoSchema
    });
    const cookie = mirroredSessionCookieMutation(
      response.headers,
      sessionCookieName
    );
    if (!cookie || cookie.kind !== "set") {
      reportError(new Error("Login response did not establish a session"));
      return {
        status: "error",
        message: "We could not complete login. Please try again."
      };
    }
    applyCookie(cookie);

    return {
      status: "success",
      authenticated: true,
      redirectTo: safeLocalNext(input.next) ?? "/account"
    };
  } catch (error) {
    reportError(error);
    return { status: "error", message: safeApiErrorMessage(error) };
  }
}

export async function logoutOperation({
  api,
  cookieHeader,
  sessionCookieName,
  applyCookie,
  reportError = defaultErrorReporter
}: Omit<Dependencies, "sessionCookieValue">): Promise<LogoutResult> {
  try {
    const { response } = await api({
      path: "/auth/logout",
      method: "POST",
      cookieHeader,
      responseSchema: z.undefined()
    });
    const upstreamCookie = mirroredSessionCookieMutation(
      response.headers,
      sessionCookieName
    );
    if (upstreamCookie?.kind === "delete") {
      applyCookie(upstreamCookie);
      if (upstreamCookie.options.path !== "/") {
        applyCookie(configuredCookieDeletion(sessionCookieName));
      }
    } else {
      // A successful status without the configured deletion is incomplete. Do
      // not report logout success while retaining the browser's root session.
      applyCookie(configuredCookieDeletion(sessionCookieName));
    }
  } catch (error) {
    // Logout remains locally effective even when the API is unavailable. The
    // reporter receives only the typed error; neither cookie headers nor token
    // values are included in diagnostics or the public result.
    reportError(error);
    applyCookie(configuredCookieDeletion(sessionCookieName));
  }

  return { status: "success", redirectTo: "/" };
}

export function safeLocalNext(value: string | undefined): string | null {
  return safeLocalPath(value);
}

function defaultErrorReporter(error: unknown): void {
  if (error instanceof ApiContractError) {
    console.error("API response contract violation", {
      path: error.path,
      issues: error.issues
    });
  } else if (!(error instanceof ApiError)) {
    console.error("Authentication request failed");
  }
}
