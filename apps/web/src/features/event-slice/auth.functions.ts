import { redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import {
  applyCookieMutation,
  currentSessionRequest,
  isNativeFormPost,
  setPrivateNoStoreResponse,
  setViewerResponseCache
} from "../../server/request-boundary.server.js";
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
    const request = currentSessionRequest();
    setViewerResponseCache(Boolean(request.sessionCookieValue));

    const viewerSession = await getEventViewerSessionOperation({
      api: request.api,
      cookieHeader: request.cookieHeader,
      sessionCookieValue: request.sessionCookieValue
    });

    return {
      ...viewerSession,
      hasSessionCookie: Boolean(request.sessionCookieValue)
    };
  }
);

export const login = createServerFn({
  method: "POST",
  strict: { input: false }
})
  .validator((input: LoginInput | FormData) => validateLoginServerInput(input))
  .handler(async ({ data }) => {
    setPrivateNoStoreResponse();
    const nativeForm = isNativeFormPost();
    if (!data.valid) {
      if (nativeForm) {
        throw redirect({ href: "/login?error=login-failed", statusCode: 303 });
      }
      return {
        status: "error" as const,
        message: data.message,
        fieldErrors: data.fieldErrors
      };
    }

    const request = currentSessionRequest();
    const result = await loginOperation(data.value, {
      api: request.api,
      sessionCookieName: request.sessionCookieName,
      applyCookie: applyCookieMutation
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
  setPrivateNoStoreResponse();
  const request = currentSessionRequest();
  const result = await logoutOperation({
    api: request.api,
    cookieHeader: request.cookieHeader,
    sessionCookieName: request.sessionCookieName,
    applyCookie: applyCookieMutation
  });

  if (isNativeFormPost()) {
    throw redirect({ href: result.redirectTo, statusCode: 303 });
  }
  return result;
});
