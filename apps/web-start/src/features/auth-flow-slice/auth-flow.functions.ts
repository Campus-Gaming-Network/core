import { redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import {
  goBFFForCurrentRequest,
  isNativeFormPost,
  setPrivateNoStoreResponse
} from "../../server/request-boundary.server.js";
import {
  forgotPasswordOperation,
  resendVerificationOperation,
  resetPasswordOperation,
  signupOperation,
  verifyEmailOperation
} from "./auth-flow-operations.server.js";
import {
  validateEmailServerInput,
  validateResetPasswordServerInput,
  validateSignupServerInput,
  validateVerificationTokenServerInput,
  type EmailInput,
  type ResetPasswordInput,
  type SignupInput,
  type VerificationTokenInput
} from "./contracts.js";
import { signupSchoolSearchOperation } from "./signup-school-operations.server.js";

export const establishPrivateAuthPage = createServerFn({ method: "GET" })
  .handler(() => {
    setPrivateNoStoreResponse();
    return { private: true as const };
  });

export const getSignupSchools = createServerFn({ method: "GET" })
  .validator((query: string) => query)
  .handler(async ({ data }) =>
    signupSchoolSearchOperation(data, { api: goBFFForCurrentRequest() })
  );

export const signup = createServerFn({ method: "POST", strict: { input: false } })
  .validator((input: SignupInput | FormData) => validateSignupServerInput(input))
  .handler(async ({ data }) => {
    setPrivateNoStoreResponse();
    const nativeForm = isNativeFormPost();
    if (!data.valid) {
      if (nativeForm) nativeRedirect("/signup?auth=failed");
      return validationResult(data);
    }

    const result = await signupOperation(data.value, {
      api: goBFFForCurrentRequest()
    });
    if (nativeForm) {
      nativeRedirect(
        result.status === "success"
          ? "/signup?auth=created"
          : "/signup?auth=failed"
      );
    }
    return result;
  });

export const forgotPassword = createServerFn({
  method: "POST",
  strict: { input: false }
})
  .validator((input: EmailInput | FormData) => validateEmailServerInput(input))
  .handler(async ({ data }) => {
    setPrivateNoStoreResponse();
    const nativeForm = isNativeFormPost();
    if (!data.valid) {
      if (nativeForm) nativeRedirect("/forgot-password?request=failed");
      return validationResult(data);
    }

    const result = await forgotPasswordOperation(data.value, {
      api: goBFFForCurrentRequest()
    });
    if (nativeForm) {
      nativeRedirect(
        `/forgot-password?request=${result.status === "success" ? "sent" : "failed"}`
      );
    }
    return result;
  });

export const resetPassword = createServerFn({
  method: "POST",
  strict: { input: false }
})
  .validator((input: ResetPasswordInput | FormData) =>
    validateResetPasswordServerInput(input)
  )
  .handler(async ({ data }) => {
    setPrivateNoStoreResponse();
    const nativeForm = isNativeFormPost();
    if (!data.valid) {
      if (nativeForm) nativeRedirect("/reset-password?reset=failed");
      return validationResult(data);
    }

    const result = await resetPasswordOperation(data.value, {
      api: goBFFForCurrentRequest()
    });
    if (nativeForm) {
      nativeRedirect(
        result.status === "success"
          ? "/login?reset=complete"
          : "/reset-password?reset=failed"
      );
    }
    return result;
  });

export const resendVerification = createServerFn({
  method: "POST",
  strict: { input: false }
})
  .validator((input: EmailInput | FormData) => validateEmailServerInput(input))
  .handler(async ({ data }) => {
    setPrivateNoStoreResponse();
    const nativeForm = isNativeFormPost();
    if (!data.valid) {
      if (nativeForm) {
        nativeRedirect("/auth/verify-email?resend=failed");
      }
      return validationResult(data);
    }

    const result = await resendVerificationOperation(data.value, {
      api: goBFFForCurrentRequest()
    });
    if (nativeForm) {
      nativeRedirect(
        `/auth/verify-email?resend=${result.status === "success" ? "sent" : "failed"}`
      );
    }
    return result;
  });

export const verifyEmail = createServerFn({
  method: "POST",
  strict: { input: false }
})
  .validator((input: VerificationTokenInput | FormData) =>
    validateVerificationTokenServerInput(input)
  )
  .handler(async ({ data }) => {
    setPrivateNoStoreResponse();
    const nativeForm = isNativeFormPost();
    if (!data.valid) {
      if (nativeForm) {
        nativeRedirect("/auth/verify-email?error=invalid-link");
      }
      return {
        ...validationResult(data),
        message: "That link is invalid or has expired."
      };
    }

    const result = await verifyEmailOperation(data.value, {
      api: goBFFForCurrentRequest()
    });
    if (nativeForm) {
      nativeRedirect(
        result.status === "success"
          ? "/auth/verify-email?verified=complete"
          : "/auth/verify-email?error=invalid-link"
      );
    }
    return result;
  });

function nativeRedirect(href: string): never {
  throw redirect({ href, statusCode: 303 });
}

function validationResult(data: {
  message: string;
  fieldErrors: Record<string, string[] | undefined>;
}) {
  return {
    status: "error" as const,
    message: data.message,
    fieldErrors: data.fieldErrors
  };
}
