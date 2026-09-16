import * as z from "zod";
import {
  AccessAssertionError,
  validateAccessAssertion
} from "./access-assertion.server.js";
import {
  AdminApiContractError,
  AdminApiError,
  createAdminApiClient,
  type ApiClient
} from "./api.server.js";
import {
  adminCookieDeletions,
  adminCookieHeader,
  mirroredAdminCookies,
  type CookieMutation
} from "./cookies.server.js";
import { adminSessionSchema, type AdminSession } from "./contracts.server.js";

export type AdminShellSession =
  | { status: "authenticated"; session: AdminSession }
  | { status: "unauthorized" }
  | { status: "forbidden" }
  | { status: "unavailable" };

type SessionDependencies = {
  api: ApiClient;
  siteOrigin: string;
  assertion: string;
  sessionCookieName: string;
  sessionCookieValue?: string;
  csrfCookieName: string;
  strictDeployment: boolean;
  validateAssertion: (assertion: string) => Promise<void>;
  applyCookies: (mutations: CookieMutation[]) => void;
  reportError?: (error: unknown) => void;
};

export async function establishAdminSession({
  api,
  siteOrigin,
  assertion,
  sessionCookieName,
  sessionCookieValue,
  csrfCookieName,
  strictDeployment,
  validateAssertion,
  applyCookies,
  reportError = defaultErrorReporter
}: SessionDependencies): Promise<AdminShellSession> {
  if (sessionCookieValue) {
    try {
      const { data } = await api({
        path: "/admin/v1/session",
        responseSchema: adminSessionSchema,
        cookieHeader: adminCookieHeader(
          sessionCookieName,
          sessionCookieValue
        )
      });
      return { status: "authenticated", session: data };
    } catch (error) {
      if (!(error instanceof AdminApiError) || error.status !== 401) {
        reportError(error);
        return statusForError(error);
      }
    }
  }

  try {
    await validateAssertion(assertion);
    const { data, response } = await api({
      path: "/admin/v1/auth/exchange",
      method: "POST",
      responseSchema: adminSessionSchema,
      headers: {
        Origin: siteOrigin,
        "Cf-Access-Jwt-Assertion": assertion
      }
    });
    const cookies = mirroredAdminCookies(
      response.headers,
      { session: sessionCookieName, csrf: csrfCookieName },
      strictDeployment
    );
    if (!cookies || cookies.some((cookie) => cookie.kind !== "set")) {
      reportError(new Error("Admin exchange omitted secure session cookies"));
      return { status: "unavailable" };
    }
    applyCookies(cookies);
    return { status: "authenticated", session: data };
  } catch (error) {
    reportError(error);
    return statusForError(error);
  }
}

export async function logoutAdminSession({
  api,
  siteOrigin,
  sessionCookieName,
  sessionCookieValue,
  csrfCookieName,
  csrfCookieValue,
  applyCookies,
  reportError = defaultErrorReporter
}: {
  api: ApiClient;
  siteOrigin: string;
  sessionCookieName: string;
  sessionCookieValue?: string;
  csrfCookieName: string;
  csrfCookieValue?: string;
  applyCookies: (mutations: CookieMutation[]) => void;
  reportError?: (error: unknown) => void;
}): Promise<void> {
  try {
    if (sessionCookieValue && csrfCookieValue) {
      await api({
        path: "/admin/v1/logout",
        method: "POST",
        responseSchema: z.undefined(),
        cookieHeader: adminCookieHeader(
          sessionCookieName,
          sessionCookieValue,
          csrfCookieName,
          csrfCookieValue
        ),
        headers: {
          Origin: siteOrigin,
          "X-CGN-Admin-CSRF": csrfCookieValue
        }
      });
    }
  } catch (error) {
    reportError(error);
  } finally {
    applyCookies(
      adminCookieDeletions({ session: sessionCookieName, csrf: csrfCookieName })
    );
  }
}

export function createSessionDependencies(environment: {
  apiInternalURL: string;
  apiProxySecret: string;
  siteOrigin: string;
  sessionCookieName: string;
  csrfCookieName: string;
  deploymentEnvironment: string;
  accessIssuer?: string;
  accessAudience?: string;
  accessJWKSURL?: string;
}): Pick<
  SessionDependencies,
  | "api"
  | "siteOrigin"
  | "sessionCookieName"
  | "csrfCookieName"
  | "strictDeployment"
  | "validateAssertion"
> {
  return {
    api: createAdminApiClient({
      baseURL: environment.apiInternalURL,
      proxySecret: environment.apiProxySecret
    }),
    siteOrigin: environment.siteOrigin,
    sessionCookieName: environment.sessionCookieName,
    csrfCookieName: environment.csrfCookieName,
    strictDeployment: environment.deploymentEnvironment !== "local",
    validateAssertion: (assertion) =>
      validateAccessAssertion(assertion, {
        issuer: environment.accessIssuer,
        audience: environment.accessAudience,
        jwksURL: environment.accessJWKSURL
      })
  };
}

function statusForError(error: unknown): AdminShellSession {
  if (error instanceof AccessAssertionError) {
    return error.reason === "unavailable"
      ? { status: "unavailable" }
      : { status: "unauthorized" };
  }
  if (error instanceof AdminApiError) {
    if (error.status === 401) return { status: "unauthorized" };
    if (error.status === 403) return { status: "forbidden" };
  }
  return { status: "unavailable" };
}

function defaultErrorReporter(error: unknown): void {
  if (error instanceof AdminApiContractError) {
    console.error("Admin API response contract violation", {
      path: error.path
    });
  } else if (
    !(error instanceof AdminApiError) &&
    !(error instanceof AccessAssertionError)
  ) {
    console.error("Admin session request failed");
  }
}
