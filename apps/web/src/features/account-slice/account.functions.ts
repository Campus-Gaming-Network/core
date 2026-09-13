import { redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import {
  applyCookieMutation,
  currentSessionRequest,
  isNativeFormPost,
  setPrivateNoStoreResponse
} from "../../server/request-boundary.server.js";
import {
  accountDashboardOperation,
  deleteAccountOperation,
  updateProfileOperation
} from "./account-operations.server.js";
import {
  validateDeleteAccountInput,
  validateUpdateProfileInput,
  type DeleteAccountInput,
  type UpdateProfileInput
} from "./contracts.js";

export const getAccountDashboard = createServerFn({ method: "GET" }).handler(
  async () => {
    const request = currentSessionRequest();
    setPrivateNoStoreResponse();
    if (!request.sessionCookieValue) return { status: "unauthenticated" as const };
    return accountDashboardOperation({
      api: request.api,
      cookieHeader: request.cookieHeader
    });
  }
);

export const updateAccountProfile = createServerFn({
  method: "POST",
  strict: { input: false }
})
  .validator((input: UpdateProfileInput | FormData) =>
    validateUpdateProfileInput(input)
  )
  .handler(async ({ data }) => {
    setPrivateNoStoreResponse();
    const nativeForm = isNativeFormPost();
    if (!data.valid) {
      if (nativeForm) {
        throw redirect({ href: "/account?account=profile-failed", statusCode: 303 });
      }
      return {
        status: "error" as const,
        message: data.message,
        fieldErrors: data.fieldErrors
      };
    }

    const request = currentSessionRequest();
    const result = await updateProfileOperation(data.value, {
      api: request.api,
      cookieHeader: request.cookieHeader
    });
    if (nativeForm) {
      throw redirect({
        href: result.status === "success"
          ? result.redirectTo
          : "/account?account=profile-failed",
        statusCode: 303
      });
    }
    return result;
  });

export const deleteAccount = createServerFn({
  method: "POST",
  strict: { input: false }
})
  .validator((input: DeleteAccountInput | FormData) =>
    validateDeleteAccountInput(input)
  )
  .handler(async ({ data }) => {
    setPrivateNoStoreResponse();
    const nativeForm = isNativeFormPost();
    if (!data.valid) {
      if (nativeForm) {
        throw redirect({ href: "/account?account=delete-failed", statusCode: 303 });
      }
      return {
        status: "error" as const,
        message: data.message,
        fieldErrors: data.fieldErrors
      };
    }

    const request = currentSessionRequest();
    const result = await deleteAccountOperation(data.value, {
      api: request.api,
      cookieHeader: request.cookieHeader,
      sessionCookieName: request.sessionCookieName,
      applyCookie: applyCookieMutation
    });
    if (nativeForm) {
      throw redirect({
        href: result.status === "success"
          ? result.redirectTo
          : "/account?account=delete-failed",
        statusCode: 303
      });
    }
    return result;
  });
