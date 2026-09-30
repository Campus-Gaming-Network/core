import * as z from "zod";
import {
  AccessAssertionError,
  validateAccessAssertion,
  type AccessIdentity,
} from "./access-assertion.server.js";
import {
  AdminApiContractError,
  AdminApiError,
  createAdminApiClient,
  type ApiClient,
} from "./api.server.js";
import {
  adminCookieDeletions,
  adminCookieHeader,
  mirroredAdminCookies,
  type CookieMutation,
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
  validateAssertion: (assertion: string) => Promise<AccessIdentity | undefined>;
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
  reportError = defaultErrorReporter,
}: SessionDependencies): Promise<AdminShellSession> {
  // Every request proves its Access identity. A session is bound to the
  // identity it was issued to, so a cookie alone never authorizes a request.
  // Only a local console with no Access configuration, in front of a stand-in
  // API, has no identity to verify; the real API refuses such requests.
  let identity: AccessIdentity | undefined;
  try {
    identity = await validateAssertion(assertion);
  } catch (error) {
    reportError(error);
    return statusForError(error);
  }

  if (sessionCookieValue) {
    try {
      const { data } = await api({
        path: "/admin/v1/session",
        responseSchema: adminSessionSchema,
        cookieHeader: adminCookieHeader(sessionCookieName, sessionCookieValue),
        accessEmail: identity?.email,
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
    if (!identity) throw unverifiedAssertionError(assertion);
    const { data, response } = await api({
      path: "/admin/v1/auth/exchange",
      method: "POST",
      responseSchema: adminSessionSchema,
      headers: {
        Origin: siteOrigin,
        "Cf-Access-Jwt-Assertion": assertion,
      },
    });
    const cookies = mirroredAdminCookies(
      response.headers,
      { session: sessionCookieName, csrf: csrfCookieName },
      strictDeployment,
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
  assertion,
  sessionCookieName,
  sessionCookieValue,
  csrfCookieName,
  csrfCookieValue,
  validateAssertion,
  applyCookies,
  reportError = defaultErrorReporter,
}: {
  api: ApiClient;
  siteOrigin: string;
  assertion: string;
  validateAssertion: (assertion: string) => Promise<AccessIdentity | undefined>;
  sessionCookieName: string;
  sessionCookieValue?: string;
  csrfCookieName: string;
  csrfCookieValue?: string;
  applyCookies: (mutations: CookieMutation[]) => void;
  reportError?: (error: unknown) => void;
}): Promise<void> {
  try {
    if (sessionCookieValue && csrfCookieValue) {
      const identity = await validateAssertion(assertion);
      await api({
        path: "/admin/v1/logout",
        method: "POST",
        responseSchema: z.undefined(),
        cookieHeader: adminCookieHeader(
          sessionCookieName,
          sessionCookieValue,
          csrfCookieName,
          csrfCookieValue,
        ),
        headers: {
          Origin: siteOrigin,
          "X-CGN-Admin-CSRF": csrfCookieValue,
        },
        accessEmail: identity?.email,
      });
    }
  } catch (error) {
    reportError(error);
  } finally {
    applyCookies(
      adminCookieDeletions({
        session: sessionCookieName,
        csrf: csrfCookieName,
      }),
    );
  }
}

export async function stepUpAdminSession({
  api,
  siteOrigin,
  assertion,
  sessionCookieName,
  sessionCookieValue,
  csrfCookieName,
  csrfCookieValue,
  strictDeployment,
  validateAssertion,
  applyCookies,
  reportError = defaultErrorReporter,
}: {
  api: ApiClient;
  siteOrigin: string;
  assertion: string;
  sessionCookieName: string;
  sessionCookieValue?: string;
  csrfCookieName: string;
  csrfCookieValue?: string;
  strictDeployment: boolean;
  validateAssertion: (assertion: string) => Promise<AccessIdentity | undefined>;
  applyCookies: (mutations: CookieMutation[]) => void;
  reportError?: (error: unknown) => void;
}): Promise<AdminShellSession> {
  if (!sessionCookieValue || !csrfCookieValue) {
    return { status: "unauthorized" };
  }

  try {
    const identity = await validateAssertion(assertion);
    if (!identity) throw unverifiedAssertionError(assertion);
    const { data, response } = await api({
      path: "/admin/v1/auth/step-up",
      method: "POST",
      responseSchema: adminSessionSchema,
      cookieHeader: adminCookieHeader(
        sessionCookieName,
        sessionCookieValue,
        csrfCookieName,
        csrfCookieValue,
      ),
      headers: {
        Origin: siteOrigin,
        "Cf-Access-Jwt-Assertion": assertion,
        "X-CGN-Admin-CSRF": csrfCookieValue,
      },
      accessEmail: identity.email,
    });
    const cookies = mirroredAdminCookies(
      response.headers,
      { session: sessionCookieName, csrf: csrfCookieName },
      strictDeployment,
    );
    if (!cookies || cookies.some((cookie) => cookie.kind !== "set")) {
      reportError(new Error("Admin step-up omitted secure session cookies"));
      return { status: "unavailable" };
    }
    applyCookies(cookies);
    return { status: "authenticated", session: data };
  } catch (error) {
    reportError(error);
    return statusForError(error);
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
      proxySecret: environment.apiProxySecret,
    }),
    siteOrigin: environment.siteOrigin,
    sessionCookieName: environment.sessionCookieName,
    csrfCookieName: environment.csrfCookieName,
    strictDeployment: environment.deploymentEnvironment !== "local",
    validateAssertion: (assertion) =>
      !environment.accessIssuer &&
      !environment.accessAudience &&
      !environment.accessJWKSURL &&
      environment.deploymentEnvironment === "local"
        ? Promise.resolve(undefined)
        : validateAccessAssertion(assertion, {
            issuer: environment.accessIssuer,
            audience: environment.accessAudience,
            jwksURL: environment.accessJWKSURL,
          }),
  };
}

// A console with no Access configuration cannot establish or confirm a
// session: without an assertion the visitor must sign in, with one it is
// unavailable because nothing can verify it.
function unverifiedAssertionError(assertion: string): AccessAssertionError {
  return new AccessAssertionError(assertion.trim() ? "unavailable" : "missing");
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
      path: error.path,
    });
  } else if (
    !(error instanceof AdminApiError) &&
    !(error instanceof AccessAssertionError)
  ) {
    console.error("Admin session request failed");
  }
}
