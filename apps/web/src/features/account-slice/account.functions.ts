import { redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import {
  applyCookieMutation,
  currentSessionRequest,
  goBFFForCurrentRequest,
  isNativeFormPost,
  setPrivateNoStoreResponse,
} from "../../server/request-boundary.server.js";
import {
  accountDashboardOperation,
  accountProfileOperation,
  changeEmailOperation,
  changePasswordOperation,
  confirmEmailChangeOperation,
  deleteAccountOperation,
  directorySidebarOperation,
  updateProfileOperation,
} from "./account-operations.server.js";
import {
  validateDeleteAccountInput,
  validateUpdateProfileInput,
  type DeleteAccountInput,
  type DirectorySidebarResult,
  type UpdateProfileInput,
} from "./contracts.js";
import {
  securityValidationNotice,
  validateChangeEmailInput,
  validateChangePasswordInput,
  validateConfirmEmailChangeInput,
  type ChangeEmailInput,
  type ChangePasswordInput,
  type ConfirmEmailChangeInput,
  type SecurityForm,
} from "./security.js";

export const getAccountDashboard = createServerFn({ method: "GET" }).handler(
  async () => {
    const request = currentSessionRequest();
    setPrivateNoStoreResponse();
    if (!request.sessionCookieValue)
      return { status: "unauthenticated" as const };
    return accountDashboardOperation({
      api: request.api,
      cookieHeader: request.cookieHeader,
    });
  },
);

// A visitor's request makes no upstream call and leaves the page's caching
// alone; a viewer's makes the page private.
const getDirectorySidebar = createServerFn({ method: "GET" }).handler(
  async (): Promise<DirectorySidebarResult> => {
    const request = currentSessionRequest();
    if (!request.sessionCookieValue) return { status: "visitor" };
    setPrivateNoStoreResponse();
    return directorySidebarOperation({
      api: request.api,
      cookieHeader: request.cookieHeader,
    });
  },
);

/** The sidebar for a directory loader; a failed call never fails the page. */
export function loadDirectorySidebar(): Promise<DirectorySidebarResult> {
  return getDirectorySidebar().catch(() => ({
    status: "unavailable" as const,
  }));
}

export const getAccountProfile = createServerFn({ method: "GET" }).handler(
  async () => {
    const request = currentSessionRequest();
    setPrivateNoStoreResponse();
    if (!request.sessionCookieValue)
      return { status: "unauthenticated" as const };
    return accountProfileOperation({
      api: request.api,
      cookieHeader: request.cookieHeader,
    });
  },
);

export const updateAccountProfile = createServerFn({
  method: "POST",
  strict: { input: false },
})
  .validator((input: UpdateProfileInput | FormData) =>
    validateUpdateProfileInput(input),
  )
  .handler(async ({ data }) => {
    setPrivateNoStoreResponse();
    const nativeForm = isNativeFormPost();
    if (!data.valid) {
      if (nativeForm) {
        throw redirect({
          href: "/settings/profile?settings=profile-failed",
          statusCode: 303,
        });
      }
      return {
        status: "error" as const,
        message: data.message,
        fieldErrors: data.fieldErrors,
      };
    }

    const request = currentSessionRequest();
    const result = await updateProfileOperation(data.value, {
      api: request.api,
      cookieHeader: request.cookieHeader,
    });
    if (nativeForm) {
      throw redirect({
        href:
          result.status === "success"
            ? result.redirectTo
            : "/settings/profile?settings=profile-failed",
        statusCode: 303,
      });
    }
    return result;
  });

export const deleteAccount = createServerFn({
  method: "POST",
  strict: { input: false },
})
  .validator((input: DeleteAccountInput | FormData) =>
    validateDeleteAccountInput(input),
  )
  .handler(async ({ data }) => {
    setPrivateNoStoreResponse();
    const nativeForm = isNativeFormPost();
    if (!data.valid) {
      if (nativeForm) {
        throw redirect({
          href: "/settings/delete-account?account=delete-failed",
          statusCode: 303,
        });
      }
      return {
        status: "error" as const,
        message: data.message,
        fieldErrors: data.fieldErrors,
      };
    }

    const request = currentSessionRequest();
    const result = await deleteAccountOperation(data.value, {
      api: request.api,
      cookieHeader: request.cookieHeader,
      sessionCookieName: request.sessionCookieName,
      applyCookie: applyCookieMutation,
    });
    if (nativeForm) {
      throw redirect({
        href:
          result.status === "success"
            ? result.redirectTo
            : "/settings/delete-account?account=delete-failed",
        statusCode: 303,
      });
    }
    return result;
  });

export const changePassword = createServerFn({
  method: "POST",
  strict: { input: false },
})
  .validator((input: ChangePasswordInput | FormData) =>
    validateChangePasswordInput(input),
  )
  .handler(async ({ data }) => {
    setPrivateNoStoreResponse();
    const request = currentSessionRequest();
    if (!data.valid) return securityValidationFailure("password", data);
    const result = await changePasswordOperation(data.value, {
      api: request.api,
      cookieHeader: request.cookieHeader,
    });
    if (isNativeFormPost()) {
      throw redirect({
        href:
          result.status === "success"
            ? result.redirectTo
            : `/settings/security?security=${result.notice}`,
        statusCode: 303,
      });
    }
    return result;
  });

export const changeEmail = createServerFn({
  method: "POST",
  strict: { input: false },
})
  .validator((input: ChangeEmailInput | FormData) =>
    validateChangeEmailInput(input),
  )
  .handler(async ({ data }) => {
    setPrivateNoStoreResponse();
    const request = currentSessionRequest();
    if (!data.valid) return securityValidationFailure("email", data);
    const result = await changeEmailOperation(data.value, {
      api: request.api,
      cookieHeader: request.cookieHeader,
    });
    if (isNativeFormPost()) {
      throw redirect({
        href:
          result.status === "success"
            ? result.redirectTo
            : `/settings/security?security=${result.notice}`,
        statusCode: 303,
      });
    }
    return result;
  });

export const confirmEmailChange = createServerFn({
  method: "POST",
  strict: { input: false },
})
  .validator((input: ConfirmEmailChangeInput | FormData) =>
    validateConfirmEmailChangeInput(input),
  )
  .handler(async ({ data }) => {
    setPrivateNoStoreResponse();
    const nativeForm = isNativeFormPost();
    const result = data.valid
      ? await confirmEmailChangeOperation(data.value, {
          api: goBFFForCurrentRequest(),
        })
      : {
          status: "error" as const,
          message: "That link is invalid or has expired.",
        };
    if (nativeForm) {
      throw redirect({
        href:
          result.status === "success"
            ? "/confirm-email-change?changed=complete"
            : "/confirm-email-change?error=invalid-link",
        statusCode: 303,
      });
    }
    return result;
  });

/**
 * Input the web server rejected: a post without JavaScript goes back to the
 * page with the field's notice; the enhanced form gets the field errors.
 */
function securityValidationFailure(
  form: SecurityForm,
  data: {
    message: string;
    fieldErrors: Record<string, string[] | undefined>;
  },
) {
  if (isNativeFormPost()) {
    throw redirect({
      href: `/settings/security?security=${securityValidationNotice(form, data.fieldErrors)}`,
      statusCode: 303,
    });
  }
  return {
    status: "error" as const,
    message: data.message,
    fieldErrors: data.fieldErrors,
  };
}
