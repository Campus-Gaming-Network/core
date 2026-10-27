import * as z from "zod";
import { ApiError, type ApiClient } from "../../server/api.server.js";
import { apiErrorReporter } from "../../server/api-error-reporter.server.js";
import type { GoalSender } from "../../server/analytics.server.js";
import { profileDtoSchema } from "../../server/viewer.server.js";
import {
  authStatusDtoSchema,
  currentPoliciesDtoSchema,
  type SignupPolicies,
  type AuthMutationResult,
  type EmailInput,
  type ResetPasswordInput,
  type SignupInput,
  type VerificationTokenInput,
} from "./contracts.js";

type Dependencies = {
  api: ApiClient;
  reportError?: (error: unknown) => void;
};

type SignupDependencies = Dependencies & { sendGoal?: GoalSender };

export async function signupOperation(
  input: SignupInput,
  { sendGoal = () => {}, ...dependencies }: SignupDependencies,
): Promise<AuthMutationResult> {
  const result = await performAuthMutation(
    {
      path: "/auth/signup",
      body: {
        email: input.email,
        password: input.password,
        name: input.name,
        home_school_id: input.home_school_id,
        age_confirmed: input.age_confirmed,
        timezone: input.timezone,
        // Agreement and acknowledgement are separate facts in the API.
        terms_agreed: input.policies_accepted,
        terms_version: input.terms_version,
        privacy_acknowledged: input.policies_accepted,
        privacy_version: input.privacy_version,
      },
      responseSchema: profileDtoSchema,
      successMessage:
        "Account created. Check your email for the verification link before logging in.",
    },
    dependencies,
  );
  if (result.status === "success") sendGoal({ name: "Signup" });
  return result;
}

/**
 * The Terms and Privacy versions a signup accepts. Without them the form
 * cannot name what the person agreed to, so signup is unavailable.
 */
export async function currentPoliciesOperation({
  api,
  reportError = defaultErrorReporter,
}: Dependencies): Promise<SignupPolicies | undefined> {
  try {
    const { data } = await api({
      path: "/policies/current",
      responseSchema: currentPoliciesDtoSchema,
    });
    return {
      termsVersion: data.terms.version,
      privacyVersion: data.privacy.version,
    };
  } catch (error) {
    reportError(error);
    return undefined;
  }
}

export async function forgotPasswordOperation(
  input: EmailInput,
  dependencies: Dependencies,
): Promise<AuthMutationResult> {
  return performAuthMutation(
    {
      path: "/auth/forgot-password",
      body: input,
      responseSchema: authStatusDtoSchema,
      successMessage:
        "If that account exists, a password reset link is on the way.",
    },
    dependencies,
  );
}

export async function resetPasswordOperation(
  input: ResetPasswordInput,
  dependencies: Dependencies,
): Promise<AuthMutationResult> {
  return performAuthMutation(
    {
      path: "/auth/reset-password",
      body: input,
      responseSchema: z.undefined(),
      successMessage: "Password reset.",
      redirectTo: "/login?reset=complete",
    },
    dependencies,
  );
}

export async function resendVerificationOperation(
  input: EmailInput,
  dependencies: Dependencies,
): Promise<AuthMutationResult> {
  return performAuthMutation(
    {
      path: "/auth/resend-verification",
      body: input,
      responseSchema: authStatusDtoSchema,
      successMessage:
        "If that account needs verification, another email is on the way.",
    },
    dependencies,
  );
}

export async function verifyEmailOperation(
  input: VerificationTokenInput,
  dependencies: Dependencies,
): Promise<AuthMutationResult> {
  return performAuthMutation(
    {
      path: "/auth/verify-email",
      body: input,
      responseSchema: authStatusDtoSchema,
      successMessage: "Your email is verified.",
    },
    dependencies,
  );
}

async function performAuthMutation(
  request: {
    path: string;
    body: unknown;
    responseSchema: z.ZodType;
    successMessage: string;
    redirectTo?: string;
  },
  { api, reportError = defaultErrorReporter }: Dependencies,
): Promise<AuthMutationResult> {
  try {
    await api({
      path: request.path,
      method: "POST",
      body: request.body,
      responseSchema: request.responseSchema,
    });
    return {
      status: "success",
      message: request.successMessage,
      ...(request.redirectTo ? { redirectTo: request.redirectTo } : {}),
    };
  } catch (error) {
    reportError(error);
    const message = authErrorMessage(error);
    const field =
      error instanceof ApiError ? errorFields[error.code] : undefined;
    return {
      status: "error",
      message,
      ...(field ? { fieldErrors: { [field]: [message] } } : {}),
    };
  }
}

const errorFields: Record<string, string> = {
  email_already_registered: "email",
  home_school_not_found: "home_school_id",
};

function authErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return "Something went wrong. Please try again.";
  }

  const messages: Record<string, string> = {
    database_unavailable: "The service is starting up. Try again in a moment.",
    email_already_registered:
      "That email already has an account. Log in, or reset your password if you forgot it.",
    home_school_not_found: "Choose an active home school from the list.",
    invalid_or_expired_token: "That link is invalid or has expired.",
    invalid_request: "Check the form fields and try again.",
    policy_version_mismatch:
      "Our Terms or Privacy Policy changed. Reload this page, review them, and try again.",
    rate_limited: "Too many attempts. Please try again later.",
  };
  return messages[error.code] ?? "Something went wrong. Please try again.";
}

const defaultErrorReporter = apiErrorReporter("Authentication");
