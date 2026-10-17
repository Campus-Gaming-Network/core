import * as z from "zod";
import type { PageNotice } from "../../components/page-notice.js";
import { pageHead } from "../../components/public-page-head.js";

/**
 * The email-and-password settings page: its inputs, and the notice codes a
 * form post without JavaScript lands on. An error code also names the field
 * it belongs to, so the page shows the same summary and inline error the
 * enhanced form does.
 */

type FieldErrors = Record<string, string[] | undefined>;

const currentPasswordSchema = z
  .string()
  .min(1, "Enter your current password.")
  .max(256, "Password must be 256 characters or fewer.");

const changePasswordInputSchema = z.object({
  current_password: currentPasswordSchema,
  new_password: z
    .string()
    .min(8, "Use at least 8 characters for your new password.")
    .max(256, "Password must be 256 characters or fewer."),
});

const changeEmailInputSchema = z.object({
  current_password: currentPasswordSchema,
  new_email: z
    .string()
    .trim()
    .toLowerCase()
    .max(320, "Email must be 320 characters or fewer.")
    .pipe(z.email("Enter a valid email address.")),
});

const confirmEmailChangeInputSchema = z.object({
  token: z.string().trim().min(1).max(512),
});

export type ChangePasswordInput = z.output<typeof changePasswordInputSchema>;
export type ChangeEmailInput = z.output<typeof changeEmailInputSchema>;
export type ConfirmEmailChangeInput = z.output<
  typeof confirmEmailChangeInputSchema
>;

type Validated<T> =
  | { valid: true; value: T }
  | { valid: false; message: string; fieldErrors: FieldErrors };

export function validateChangePasswordInput(
  input: ChangePasswordInput | FormData,
): Validated<ChangePasswordInput> {
  return validated(
    changePasswordInputSchema,
    input instanceof FormData
      ? {
          current_password: formString(input, "current_password"),
          new_password: formString(input, "new_password"),
        }
      : input,
  );
}

export function validateChangeEmailInput(
  input: ChangeEmailInput | FormData,
): Validated<ChangeEmailInput> {
  return validated(
    changeEmailInputSchema,
    input instanceof FormData
      ? {
          current_password: formString(input, "current_password"),
          new_email: formString(input, "new_email"),
        }
      : input,
  );
}

export function validateConfirmEmailChangeInput(
  input: ConfirmEmailChangeInput | FormData,
): Validated<ConfirmEmailChangeInput> {
  return validated(
    confirmEmailChangeInputSchema,
    input instanceof FormData ? { token: formString(input, "token") } : input,
  );
}

export type SecurityForm = "password" | "email";

type SecurityNotice = PageNotice & {
  /** The form an error belongs to and the field it points at. */
  form?: SecurityForm;
  field?: string;
};

export const securityNotices = {
  "password-changed": {
    message: "Password changed. Other devices were signed out.",
    severity: "success",
  },
  "email-sent": {
    message:
      "Check the new address for a confirmation link. Your email changes when you follow it.",
    severity: "success",
  },
  "password-current": {
    message: "Your current password is incorrect.",
    severity: "danger",
    form: "password",
    field: "current_password",
  },
  "password-new": {
    message: "Use at least 8 characters for your new password.",
    severity: "danger",
    form: "password",
    field: "new_password",
  },
  "password-failed": {
    message: "We could not change your password. Please try again.",
    severity: "danger",
    form: "password",
  },
  "email-current": {
    message: "Your current password is incorrect.",
    severity: "danger",
    form: "email",
    field: "current_password",
  },
  "email-invalid": {
    message: "Enter a valid email address.",
    severity: "danger",
    form: "email",
    field: "new_email",
  },
  "email-unchanged": {
    message: "That is already your email address.",
    severity: "danger",
    form: "email",
    field: "new_email",
  },
  "email-failed": {
    message: "We could not send a confirmation link. Please try again.",
    severity: "danger",
    form: "email",
  },
  "rate-limited": {
    message: "Too many attempts. Please wait a few minutes and try again.",
    severity: "danger",
  },
} as const satisfies Record<string, SecurityNotice>;

export type SecurityNoticeKey = keyof typeof securityNotices;

/** The notice for a failed change, from the API's error code. */
export function securityFailureNotice(
  form: SecurityForm,
  code: string | undefined,
): SecurityNoticeKey {
  if (code === "rate_limited") return "rate-limited";
  if (code === "invalid_current_password") return `${form}-current`;
  if (form === "email" && code === "email_unchanged") return "email-unchanged";
  if (code === "invalid_request") {
    return form === "email" ? "email-invalid" : "password-new";
  }
  return `${form}-failed`;
}

/** The notice for input the web server rejected before calling the API. */
export function securityValidationNotice(
  form: SecurityForm,
  fieldErrors: FieldErrors,
): SecurityNoticeKey {
  if (fieldErrors.current_password) return `${form}-current`;
  return form === "email" ? "email-invalid" : "password-new";
}

/** The inline error a notice puts on its form, for a post without JavaScript. */
export function securityNoticeFieldErrors(
  key: SecurityNoticeKey | undefined,
  form: SecurityForm,
): FieldErrors {
  if (!key) return {};
  const notice: SecurityNotice = securityNotices[key];
  if (notice.form !== form || !notice.field) return {};
  return { [notice.field]: [notice.message] };
}

export function securitySettingsHead(publicOrigin?: string) {
  return pageHead(publicOrigin, {
    title: "Email and password",
    description: "Change the email and password you sign in with.",
    path: "/settings/security",
    noIndex: true,
  });
}

function validated<T>(schema: z.ZodType<T>, candidate: unknown): Validated<T> {
  const parsed = schema.safeParse(candidate);
  if (parsed.success) return { valid: true, value: parsed.data };
  const fieldErrors: FieldErrors = {};
  for (const issue of parsed.error.issues) {
    const field = String(issue.path[0] ?? "form");
    const messages = fieldErrors[field] ?? [];
    if (!messages.includes(issue.message)) messages.push(issue.message);
    fieldErrors[field] = messages;
  }
  return {
    valid: false,
    message: "Check the highlighted fields and try again.",
    fieldErrors,
  };
}

function formString(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}
