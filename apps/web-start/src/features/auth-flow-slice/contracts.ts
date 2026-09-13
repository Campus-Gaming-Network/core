import * as z from "zod";

const emailSchema = z.string().trim().max(
  320,
  "Email must be 320 characters or fewer."
).pipe(
  z.email("Enter a valid email address.")
);
const passwordSchema = z.string().trim()
  .min(8, "Password must be at least 8 characters.")
  .max(256, "Password must be 256 characters or fewer.");
const tokenSchema = z.string().trim()
  .min(1, "That link is invalid or has expired.")
  .max(4096, "That link is invalid or has expired.");
const boundedSearchSchema = z.string().trim().max(200);

export const authStatusDtoSchema = z.object({
  status: z.string().min(1).max(100)
});

export const signupInputSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: z.string().trim().min(1, "Name is required.").max(
    120,
    "Name must be 120 characters or fewer."
  ),
  home_school_id: z.string().trim().min(1, "Choose a home school.").max(200),
  age_confirmed: z.literal(true, {
    error: "Confirm that you are 18 or older."
  }),
  timezone: z.string().trim().min(1, "Time zone is required.").max(100).refine(
    validIANATimeZone,
    "Enter a valid IANA time zone."
  )
});

export const emailInputSchema = z.object({ email: emailSchema });

export const resetPasswordInputSchema = z.object({
  token: tokenSchema,
  password: passwordSchema
});

export const verificationTokenInputSchema = z.object({ token: tokenSchema });

export type SignupInput = z.output<typeof signupInputSchema>;
export type EmailInput = z.output<typeof emailInputSchema>;
export type ResetPasswordInput = z.output<typeof resetPasswordInputSchema>;
export type VerificationTokenInput = z.output<
  typeof verificationTokenInputSchema
>;

export type FormFieldErrors = Record<string, string[] | undefined>;

export type AuthMutationResult =
  | {
      status: "success";
      message: string;
      redirectTo?: string;
    }
  | {
      status: "error";
      message: string;
      fieldErrors?: FormFieldErrors;
    };

export type ValidatedServerInput<T> =
  | { valid: true; value: T }
  | {
      valid: false;
      message: "Check the highlighted fields and try again.";
      fieldErrors: FormFieldErrors;
    };

export function validateSignupServerInput(
  input: SignupInput | FormData
): ValidatedServerInput<SignupInput> {
  return validateInput(signupInputSchema, {
    email: normalizedInputValue(input, "email"),
    password: normalizedInputValue(input, "password"),
    name: normalizedInputValue(input, "name"),
    home_school_id: normalizedInputValue(input, "home_school_id"),
    age_confirmed: checkedInputValue(input, "age_confirmed"),
    timezone: normalizedInputValue(input, "timezone") || "America/Los_Angeles"
  });
}

export function validateEmailServerInput(
  input: EmailInput | FormData
): ValidatedServerInput<EmailInput> {
  return validateInput(emailInputSchema, {
    email: normalizedInputValue(input, "email")
  });
}

export function validateResetPasswordServerInput(
  input: ResetPasswordInput | FormData
): ValidatedServerInput<ResetPasswordInput> {
  return validateInput(resetPasswordInputSchema, {
    token: normalizedInputValue(input, "token"),
    password: normalizedInputValue(input, "password")
  });
}

export function validateVerificationTokenServerInput(
  input: VerificationTokenInput | FormData
): ValidatedServerInput<VerificationTokenInput> {
  return validateInput(verificationTokenInputSchema, {
    token: normalizedInputValue(input, "token")
  });
}

export type SignupSearch = {
  q?: string;
  school_id?: string;
  auth?: "created" | "failed";
};

export function validateSignupSearch(
  search: Record<string, unknown>
): SignupSearch {
  const q = boundedSearchValue(search.q);
  const schoolId = boundedSearchValue(search.school_id);
  const auth = firstString(search.auth);

  return {
    ...(q ? { q } : {}),
    ...(schoolId ? { school_id: schoolId } : {}),
    ...(auth === "created" || auth === "failed" ? { auth } : {})
  };
}

export type ForgotPasswordSearch = {
  request?: "sent" | "failed";
};

export function validateForgotPasswordSearch(
  search: Record<string, unknown>
): ForgotPasswordSearch {
  const request = firstString(search.request);
  return request === "sent" || request === "failed" ? { request } : {};
}

export type ResetPasswordSearch = {
  token?: string;
  reset?: "failed";
};

export function validateResetPasswordSearch(
  search: Record<string, unknown>
): ResetPasswordSearch {
  const token = firstString(search.token);
  const reset = firstString(search.reset);
  return {
    ...(token ? { token } : {}),
    ...(reset === "failed" ? { reset: "failed" as const } : {})
  };
}

export type VerifyEmailSearch = {
  token?: string;
  error?: "invalid-link";
  resend?: "sent" | "failed";
  verified?: "complete";
};

export function validateVerifyEmailSearch(
  search: Record<string, unknown>
): VerifyEmailSearch {
  const token = firstString(search.token);
  const error = firstString(search.error);
  const resend = firstString(search.resend);
  const verified = firstString(search.verified);

  return {
    ...(token ? { token } : {}),
    ...(error === "invalid-link" ? { error: "invalid-link" as const } : {}),
    ...(resend === "sent" || resend === "failed" ? { resend } : {}),
    ...(verified === "complete"
      ? { verified: "complete" as const }
      : {})
  };
}

export function firstString(value: unknown): string {
  if (typeof value === "string") return value;
  return Array.isArray(value) && typeof value[0] === "string" ? value[0] : "";
}

export function legacyResetDestination(token: string): string {
  return token
    ? `/reset-password?token=${encodeURIComponent(token)}`
    : "/reset-password";
}

function boundedSearchValue(value: unknown): string | undefined {
  const parsed = boundedSearchSchema.safeParse(firstString(value));
  return parsed.success && parsed.data ? parsed.data : undefined;
}

function normalizedInputValue(input: FormData | object, name: string): string {
  const value = input instanceof FormData
    ? input.get(name)
    : name in input
      ? Reflect.get(input, name)
      : undefined;
  return typeof value === "string" ? value.trim() : "";
}

function checkedInputValue(input: FormData | object, name: string): boolean {
  const value = input instanceof FormData
    ? input.get(name)
    : name in input
      ? Reflect.get(input, name)
      : undefined;
  return value === true || value === "on";
}

function validateInput<T>(
  schema: z.ZodType<T>,
  candidate: unknown
): ValidatedServerInput<T> {
  const parsed = schema.safeParse(candidate);
  if (parsed.success) return { valid: true, value: parsed.data };

  const fieldErrors: FormFieldErrors = {};
  for (const issue of parsed.error.issues) {
    const field = typeof issue.path[0] === "string" ? issue.path[0] : "_form";
    const messages = fieldErrors[field] ?? [];
    if (!messages.includes(issue.message)) messages.push(issue.message);
    fieldErrors[field] = messages;
  }
  return {
    valid: false,
    message: "Check the highlighted fields and try again.",
    fieldErrors
  };
}

function validIANATimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}
