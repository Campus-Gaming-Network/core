import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import type { FormEvent, RefObject } from "react";
import {
  FieldError,
  FormErrorSummary,
  fieldErrorProps,
} from "../../components/enhanced-mutation";
import { FormField } from "../../components/form-field";
import { FormSection } from "../../components/form-section";
import type { SchoolDTO } from "../school-slice/contracts";
import {
  forgotPassword,
  resendVerification,
  resetPassword,
  signup,
  verifyEmail,
} from "./auth-flow.functions";
import { SchoolPicker } from "./school-picker";
import { useAuthMutation } from "./use-auth-mutation";

export function SignupForm({
  schools,
  selectedSchoolId,
  initialQuery,
  initialSearchFailed,
  initialStatus,
}: {
  schools: SchoolDTO[];
  selectedSchoolId?: string;
  initialQuery?: string;
  initialSearchFailed?: boolean;
  initialStatus?: "created" | "failed";
}) {
  const runSignup = useServerFn(signup);
  const mutation = useAuthMutation(
    "We could not create your account. Please try again.",
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await mutation.execute(() => runSignup({ data: form }));
  }

  return (
    <form
      action={signup.url}
      className="form-stack sectioned-form"
      method="post"
      onSubmit={submit}
    >
      <FormNotice
        fieldErrors={mutation.fieldErrors}
        fieldIds={{
          name: "name-error",
          email: "email-error",
          password: "password-error",
          timezone: "timezone-error",
          home_school_id: "home_school_id-error",
          age_confirmed: "age_confirmed-error",
        }}
        status={
          mutation.message
            ? mutation.status
            : initialStatus === "created"
              ? "success"
              : initialStatus === "failed"
                ? "error"
                : "idle"
        }
        message={
          mutation.message ||
          (initialStatus === "created"
            ? "Account created. Check your email for the verification link before logging in."
            : initialStatus === "failed"
              ? "We could not create your account. Please try again."
              : "")
        }
        summaryRef={mutation.errorSummaryRef}
      />
      <FormSection
        title="Account details"
        description="Use an email address you can check. We send a verification link before you can log in."
      >
        <FormField
          errorId="name-error"
          errors={mutation.fieldErrors.name}
          label="Name"
        >
          <input name="name" autoComplete="name" required maxLength={120} />
        </FormField>
        <FormField
          errorId="email-error"
          errors={mutation.fieldErrors.email}
          label="Email"
        >
          <input name="email" type="email" autoComplete="email" required />
        </FormField>
        <FormField
          errorId="password-error"
          errors={mutation.fieldErrors.password}
          label="Password"
        >
          <input
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            maxLength={256}
            required
          />
        </FormField>
        <FormField
          errorId="timezone-error"
          errors={mutation.fieldErrors.timezone}
          label="Time zone"
        >
          <input
            name="timezone"
            defaultValue="America/Los_Angeles"
            autoComplete="off"
            required
          />
        </FormField>
      </FormSection>
      <FormSection
        title="Your campus"
        description="Pick your home school and confirm you are old enough to join."
      >
        <div>
          <SchoolPicker
            schools={schools}
            selectedSchoolId={selectedSchoolId}
            initialQuery={initialQuery}
            initialSearchFailed={initialSearchFailed}
            describedBy={
              mutation.fieldErrors.home_school_id
                ? "home_school_id-error"
                : undefined
            }
            invalid={Boolean(mutation.fieldErrors.home_school_id?.length)}
          />
          <FieldError
            id="home_school_id-error"
            messages={mutation.fieldErrors.home_school_id}
          />
        </div>
        <label className="checkbox-field">
          <input
            type="checkbox"
            name="age_confirmed"
            required
            {...fieldErrorProps(
              mutation.fieldErrors.age_confirmed,
              "age_confirmed-error",
            )}
          />
          <span>I confirm I am 18 or older.</span>
        </label>
        <FieldError
          id="age_confirmed-error"
          messages={mutation.fieldErrors.age_confirmed}
        />
      </FormSection>
      <div className="form-actions">
        <button type="submit" disabled={mutation.pending}>
          {mutation.pending ? "Creating account…" : "Create account"}
        </button>
      </div>
    </form>
  );
}

export function ForgotPasswordForm({
  initialStatus,
}: {
  initialStatus?: "sent" | "failed";
}) {
  const runForgotPassword = useServerFn(forgotPassword);
  const mutation = useAuthMutation(
    "We could not request a reset link. Please try again.",
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await mutation.execute(() => runForgotPassword({ data: form }));
  }

  const initialMessage =
    initialStatus === "sent"
      ? "If that account exists, a password reset link is on the way."
      : initialStatus === "failed"
        ? "We could not request a reset link. Please try again."
        : "";

  return (
    <form
      action={forgotPassword.url}
      className="form-stack"
      method="post"
      onSubmit={submit}
    >
      <FormNotice
        fieldErrors={mutation.fieldErrors}
        fieldIds={{ email: "email-error" }}
        status={
          mutation.message
            ? mutation.status
            : initialStatus === "sent"
              ? "success"
              : initialStatus === "failed"
                ? "error"
                : "idle"
        }
        message={mutation.message || initialMessage}
        summaryRef={mutation.errorSummaryRef}
      />
      <FormField
        errorId="email-error"
        errors={mutation.fieldErrors.email}
        label="Email"
      >
        <input name="email" type="email" autoComplete="email" required />
      </FormField>
      <button type="submit" disabled={mutation.pending}>
        {mutation.pending ? "Sending…" : "Send reset link"}
      </button>
    </form>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const runResetPassword = useServerFn(resetPassword);
  const mutation = useAuthMutation(
    "We could not reset your password. Request a new link and try again.",
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await mutation.execute(() => runResetPassword({ data: form }));
  }

  return (
    <form
      action={resetPassword.url}
      className="form-stack"
      method="post"
      onSubmit={submit}
    >
      <input type="hidden" name="token" value={token} />
      <FormNotice
        fieldErrors={mutation.fieldErrors}
        fieldIds={{ token: "token-error", password: "password-error" }}
        status={mutation.status}
        message={mutation.message}
        summaryRef={mutation.errorSummaryRef}
      />
      <FieldError id="token-error" messages={mutation.fieldErrors.token} />
      <FormField
        errorId="password-error"
        errors={mutation.fieldErrors.password}
        label="New password"
      >
        <input
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          maxLength={256}
          required
        />
      </FormField>
      <button type="submit" disabled={mutation.pending}>
        {mutation.pending ? "Resetting…" : "Reset password"}
      </button>
    </form>
  );
}

export function ResendVerificationForm({
  initialStatus,
}: {
  initialStatus?: "sent" | "failed";
}) {
  const runResend = useServerFn(resendVerification);
  const mutation = useAuthMutation(
    "We could not resend verification. Please try again.",
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await mutation.execute(() => runResend({ data: form }));
  }

  const initialMessage =
    initialStatus === "sent"
      ? "If that account needs verification, another email is on the way."
      : initialStatus === "failed"
        ? "We could not resend verification. Please try again."
        : "";

  return (
    <form
      action={resendVerification.url}
      className="inline-form"
      method="post"
      onSubmit={submit}
    >
      <FormNotice
        fieldErrors={mutation.fieldErrors}
        fieldIds={{ email: "email-error" }}
        status={
          mutation.message
            ? mutation.status
            : initialStatus === "sent"
              ? "success"
              : initialStatus === "failed"
                ? "error"
                : "idle"
        }
        message={mutation.message || initialMessage}
        summaryRef={mutation.errorSummaryRef}
      />
      <FormField
        errorId="email-error"
        errors={mutation.fieldErrors.email}
        label="Email"
      >
        <input name="email" type="email" autoComplete="email" required />
      </FormField>
      <button type="submit" disabled={mutation.pending}>
        {mutation.pending ? "Sending…" : "Resend verification"}
      </button>
    </form>
  );
}

export function VerifyEmailForm({ token }: { token: string }) {
  const runVerify = useServerFn(verifyEmail);
  const mutation = useAuthMutation("That link is invalid or has expired.");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await mutation.execute(() => runVerify({ data: form }));
  }

  if (mutation.status === "success") {
    return (
      <p role="status" aria-live="polite">
        {mutation.message} <Link to="/login">Log in</Link> to continue.
      </p>
    );
  }

  return (
    <>
      <form
        action={verifyEmail.url}
        className="form-stack"
        method="post"
        onSubmit={submit}
      >
        <input type="hidden" name="token" value={token} />
        <FormNotice
          fieldErrors={mutation.fieldErrors}
          fieldIds={{ token: "token-error" }}
          status={mutation.status}
          message={mutation.message}
          summaryRef={mutation.errorSummaryRef}
        />
        <FieldError id="token-error" messages={mutation.fieldErrors.token} />
        <button type="submit" disabled={mutation.pending}>
          {mutation.pending ? "Verifying…" : "Verify email"}
        </button>
      </form>
      {mutation.status === "error" ? (
        <section className="form-stack" aria-labelledby="resend-heading">
          <h2 id="resend-heading">Need a new link?</h2>
          <ResendVerificationForm />
        </section>
      ) : null}
    </>
  );
}

function FormNotice({
  fieldErrors,
  fieldIds,
  message,
  status,
  summaryRef,
}: {
  fieldErrors?: Record<string, string[] | undefined>;
  fieldIds?: Record<string, string>;
  message: string;
  status: "idle" | "success" | "error";
  summaryRef?: RefObject<HTMLDivElement | null>;
}) {
  if (!message) return null;
  if (status === "error" && summaryRef) {
    return (
      <FormErrorSummary
        fieldErrors={fieldErrors ?? {}}
        fieldIds={fieldIds}
        message={message}
        summaryRef={summaryRef}
      />
    );
  }
  return (
    <p role="status" aria-live="polite">
      {message}
    </p>
  );
}
