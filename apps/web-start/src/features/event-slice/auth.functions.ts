import { redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import {
  deleteCookie,
  getCookie,
  getRequestHeader,
  getRequestHeaders,
  setCookie,
  setResponseHeader
} from "@tanstack/react-start/server";
import { createApiClient } from "../../server/api.server.js";
import {
  sessionCookieName,
  type CookieMutation
} from "../../server/cookies.server.js";
import {
  getEventViewerSessionOperation,
  loginOperation,
  logoutOperation
} from "./auth-operations.server.js";
import {
  validateLoginServerInput,
  type LoginInput
} from "./contracts.js";

export const getEventViewerSession = createServerFn({ method: "GET" }).handler(
  async () => {
    const requestHeaders = getRequestHeaders();
    const configuredSessionCookie = sessionCookieName();
    const sessionCookieValue = getCookie(configuredSessionCookie);
    setResponseHeader("vary", "Cookie");
    setResponseHeader(
      "cache-control",
      sessionCookieValue
        ? "private, no-store"
        : "public, max-age=0, must-revalidate"
    );

    const viewerSession = await getEventViewerSessionOperation({
      api: createApiClient({ incomingHeaders: requestHeaders }),
      cookieHeader: requestHeaders.get("cookie") ?? "",
      sessionCookieValue
    });

    return {
      ...viewerSession,
      hasSessionCookie: Boolean(sessionCookieValue)
    };
  }
);

export const login = createServerFn({
  method: "POST",
  strict: { input: false }
})
  .validator((input: LoginInput | FormData) => validateLoginServerInput(input))
  .handler(async ({ data }) => {
    const nativeForm = isNativeFormPost();
    if (!data.valid) {
      if (nativeForm) {
        throw redirect({ href: "/login?error=login-failed", statusCode: 303 });
      }
      return {
        status: "error" as const,
        message: "Check the form fields and try again."
      };
    }

    const requestHeaders = getRequestHeaders();
    const result = await loginOperation(data.value, {
      api: createApiClient({ incomingHeaders: requestHeaders }),
      sessionCookieName: sessionCookieName(),
      applyCookie
    });

    if (nativeForm) {
      const destination = result.status === "success"
        ? result.redirectTo
        : "/login?error=login-failed";
      throw redirect({ href: destination, statusCode: 303 });
    }
    return result;
  });

export const logout = createServerFn({ method: "POST" }).handler(async () => {
  const requestHeaders = getRequestHeaders();
  const result = await logoutOperation({
    api: createApiClient({ incomingHeaders: requestHeaders }),
    cookieHeader: requestHeaders.get("cookie") ?? "",
    sessionCookieName: sessionCookieName(),
    applyCookie
  });

  if (isNativeFormPost()) {
    throw redirect({ href: result.redirectTo, statusCode: 303 });
  }
  return result;
});

function applyCookie(mutation: CookieMutation): void {
  if (mutation.kind === "delete") {
    deleteCookie(mutation.name, mutation.options);
  } else {
    setCookie(mutation.name, mutation.value, mutation.options);
  }
}

function isNativeFormPost(): boolean {
  const contentType = getRequestHeader("content-type") ?? "";
  return contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("multipart/form-data");
}
