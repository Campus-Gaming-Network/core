import { useServerFn } from "@tanstack/react-start";
import type { FormEvent } from "react";
import {
  FormErrorSummary,
  useEnhancedMutation,
} from "../../components/enhanced-mutation";
import { FormField } from "../../components/form-field";
import { FormSection } from "../../components/form-section";
import { PasswordInput } from "../../components/password-input";
import { emailInputProps, passwordRules } from "../auth-flow-slice/field-props";
import { changeEmail, changePassword } from "./account.functions";
import {
  securityNoticeFieldErrors,
  securityNotices,
  type SecurityForm,
  type SecurityNoticeKey,
} from "./security";

/**
 * The error a form shows: its own last answer once it has submitted with
 * JavaScript, otherwise the notice a post without JavaScript returned to.
 * Either way there is a summary at the top and an error on the field.
 */
function useSecurityFeedback(
  form: SecurityForm,
  notice: SecurityNoticeKey | undefined,
  fallbackMessage: string,
) {
  const mutation = useEnhancedMutation(fallbackMessage);
  const fromNotice = securityNoticeFieldErrors(notice, form);
  const noticeEntry: { message: string; form?: SecurityForm } | undefined =
    notice ? securityNotices[notice] : undefined;
  const noticeMessage = noticeEntry?.form === form ? noticeEntry.message : "";
  const submitted = mutation.message !== "" || mutation.pending;
  return {
    mutation,
    message: submitted ? mutation.message : noticeMessage,
    fieldErrors: submitted ? mutation.fieldErrors : fromNotice,
  };
}

const fieldIds = (prefix: string, fields: string[]) =>
  Object.fromEntries(
    fields.map((field) => [field, `${prefix}-${field}-error`]),
  );

export function ChangePasswordForm({ notice }: { notice?: SecurityNoticeKey }) {
  const runChangePassword = useServerFn(changePassword);
  const { mutation, message, fieldErrors } = useSecurityFeedback(
    "password",
    notice,
    "We could not change your password. Please try again.",
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await mutation.execute(() => runChangePassword({ data: form }));
  }

  return (
    <form
      action={changePassword.url}
      className="form-stack sectioned-form"
      method="post"
      onSubmit={submit}
    >
      <FormErrorSummary
        fieldErrors={fieldErrors}
        fieldIds={fieldIds("password", ["current_password", "new_password"])}
        message={message}
        summaryRef={mutation.errorSummaryRef}
      />
      <FormSection
        title="Change password"
        description="Enter your current password, then the new one. Other devices signed in to your account will be signed out."
      >
        <FormField
          errorId="password-current_password-error"
          errors={fieldErrors.current_password}
          label="Current password"
        >
          <PasswordInput
            autoComplete="current-password"
            maxLength={passwordRules.maxLength}
            name="current_password"
            required
          />
        </FormField>
        <FormField
          errorId="password-new_password-error"
          errors={fieldErrors.new_password}
          label="New password"
        >
          <PasswordInput
            autoComplete="new-password"
            {...passwordRules}
            name="new_password"
            required
          />
        </FormField>
        <p className="form-help">Use at least 8 characters.</p>
        <div>
          <button disabled={mutation.pending} type="submit">
            {mutation.pending ? "Changing…" : "Change password"}
          </button>
        </div>
      </FormSection>
    </form>
  );
}

export function ChangeEmailForm({
  currentEmail,
  notice,
}: {
  currentEmail: string;
  notice?: SecurityNoticeKey;
}) {
  const runChangeEmail = useServerFn(changeEmail);
  const { mutation, message, fieldErrors } = useSecurityFeedback(
    "email",
    notice,
    "We could not send a confirmation link. Please try again.",
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await mutation.execute(() => runChangeEmail({ data: form }));
  }

  return (
    <form
      action={changeEmail.url}
      className="form-stack sectioned-form"
      method="post"
      onSubmit={submit}
    >
      <FormErrorSummary
        fieldErrors={fieldErrors}
        fieldIds={fieldIds("email", ["new_email", "current_password"])}
        message={message}
        summaryRef={mutation.errorSummaryRef}
      />
      <FormSection
        title="Change email"
        description={`You sign in with ${currentEmail}. We will send a link to the new address, and your email changes when you follow it. We will also tell ${currentEmail} about the change.`}
      >
        <FormField
          errorId="email-new_email-error"
          errors={fieldErrors.new_email}
          label="New email"
        >
          <input {...emailInputProps} name="new_email" required />
        </FormField>
        <FormField
          errorId="email-current_password-error"
          errors={fieldErrors.current_password}
          label="Current password"
        >
          <PasswordInput
            autoComplete="current-password"
            maxLength={passwordRules.maxLength}
            name="current_password"
            required
          />
        </FormField>
        <div>
          <button disabled={mutation.pending} type="submit">
            {mutation.pending ? "Sending…" : "Send confirmation link"}
          </button>
        </div>
      </FormSection>
    </form>
  );
}
