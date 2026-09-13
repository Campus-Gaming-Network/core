import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { cloneElement, type FormEvent, type InputHTMLAttributes, type ReactElement } from "react";
import { FieldError, fieldErrorProps } from "../../components/enhanced-mutation";
import type { SchoolDTO } from "../school-slice/contracts";
import {
  forgotPassword,
  resendVerification,
  resetPassword,
  signup,
  verifyEmail
} from "./auth-flow.functions";
import { SchoolPicker } from "./school-picker";
import { useAuthMutation } from "./use-auth-mutation";

export function SignupForm({
  schools,
  selectedSchoolId,
  initialQuery,
  initialSearchFailed,
  initialStatus
}: {
  schools: SchoolDTO[];
  selectedSchoolId?: string;
  initialQuery?: string;
  initialSearchFailed?: boolean;
  initialStatus?: "created" | "failed";
}) {
  const runSignup = useServerFn(signup);
  const mutation = useAuthMutation("We could not create your account. Please try again.");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await mutation.execute(() => runSignup({ data: form }));
  }

  return (
    <form action={signup.url} className="form-stack" method="post" onSubmit={submit}>
      <FormNotice
        status={mutation.message
          ? mutation.status
          : initialStatus === "created"
            ? "success"
            : initialStatus === "failed"
              ? "error"
              : "idle"}
        message={mutation.message || (initialStatus === "created"
          ? "Account created. Check your email for the verification link before logging in."
          : initialStatus === "failed"
            ? "We could not create your account. Please try again."
            : "")}
      />
      <AuthField label="Name" name="name" errors={mutation.fieldErrors.name}>
        <input name="name" autoComplete="name" required maxLength={120} />
      </AuthField>
      <AuthField label="Email" name="email" errors={mutation.fieldErrors.email}>
        <input name="email" type="email" autoComplete="email" required />
      </AuthField>
      <AuthField label="Password" name="password" errors={mutation.fieldErrors.password}>
        <input name="password" type="password" autoComplete="new-password" minLength={8} maxLength={256} required />
      </AuthField>
      <AuthField label="Time zone" name="timezone" errors={mutation.fieldErrors.timezone}>
        <input name="timezone" defaultValue="America/Los_Angeles" autoComplete="off" required />
      </AuthField>
      <div>
        <SchoolPicker
          schools={schools}
          selectedSchoolId={selectedSchoolId}
          initialQuery={initialQuery}
          initialSearchFailed={initialSearchFailed}
          describedBy={mutation.fieldErrors.home_school_id ? "home_school_id-error" : undefined}
          invalid={Boolean(mutation.fieldErrors.home_school_id?.length)}
        />
        <FieldError id="home_school_id-error" messages={mutation.fieldErrors.home_school_id} />
      </div>
      <label className="checkbox-field">
        <input
          type="checkbox"
          name="age_confirmed"
          required
          {...fieldErrorProps(mutation.fieldErrors.age_confirmed, "age_confirmed-error")}
        />
        <span>I confirm I am 18 or older.</span>
      </label>
      <FieldError id="age_confirmed-error" messages={mutation.fieldErrors.age_confirmed} />
      <button type="submit" disabled={mutation.pending}>
        {mutation.pending ? "Creating account…" : "Create account"}
      </button>
    </form>
  );
}

export function ForgotPasswordForm({ initialStatus }: { initialStatus?: "sent" | "failed" }) {
  const runForgotPassword = useServerFn(forgotPassword);
  const mutation = useAuthMutation("We could not request a reset link. Please try again.");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await mutation.execute(() => runForgotPassword({ data: form }));
  }

  const initialMessage = initialStatus === "sent"
    ? "If that account exists, a password reset link is on the way."
    : initialStatus === "failed"
      ? "We could not request a reset link. Please try again."
      : "";

  return (
    <form action={forgotPassword.url} className="form-stack" method="post" onSubmit={submit}>
      <FormNotice
        status={mutation.message ? mutation.status : initialStatus === "sent" ? "success" : initialStatus === "failed" ? "error" : "idle"}
        message={mutation.message || initialMessage}
      />
      <AuthField label="Email" name="email" errors={mutation.fieldErrors.email}>
        <input name="email" type="email" autoComplete="email" required />
      </AuthField>
      <button type="submit" disabled={mutation.pending}>
        {mutation.pending ? "Sending…" : "Send reset link"}
      </button>
    </form>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const runResetPassword = useServerFn(resetPassword);
  const mutation = useAuthMutation("We could not reset your password. Request a new link and try again.");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await mutation.execute(() => runResetPassword({ data: form }));
  }

  return (
    <form action={resetPassword.url} className="form-stack" method="post" onSubmit={submit}>
      <input type="hidden" name="token" value={token} />
      <FormNotice status={mutation.status} message={mutation.message} />
      <FieldError id="token-error" messages={mutation.fieldErrors.token} />
      <AuthField label="New password" name="password" errors={mutation.fieldErrors.password}>
        <input name="password" type="password" autoComplete="new-password" minLength={8} maxLength={256} required />
      </AuthField>
      <button type="submit" disabled={mutation.pending}>
        {mutation.pending ? "Resetting…" : "Reset password"}
      </button>
    </form>
  );
}

export function ResendVerificationForm({ initialStatus }: { initialStatus?: "sent" | "failed" }) {
  const runResend = useServerFn(resendVerification);
  const mutation = useAuthMutation("We could not resend verification. Please try again.");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await mutation.execute(() => runResend({ data: form }));
  }

  const initialMessage = initialStatus === "sent"
    ? "If that account needs verification, another email is on the way."
    : initialStatus === "failed"
      ? "We could not resend verification. Please try again."
      : "";

  return (
    <form action={resendVerification.url} className="inline-form" method="post" onSubmit={submit}>
      <FormNotice
        status={mutation.message ? mutation.status : initialStatus === "sent" ? "success" : initialStatus === "failed" ? "error" : "idle"}
        message={mutation.message || initialMessage}
      />
      <AuthField label="Email" name="email" errors={mutation.fieldErrors.email}>
        <input name="email" type="email" autoComplete="email" required />
      </AuthField>
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
      <form action={verifyEmail.url} className="form-stack" method="post" onSubmit={submit}>
        <input type="hidden" name="token" value={token} />
        <FormNotice status={mutation.status} message={mutation.message} />
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

function AuthField({
  children,
  errors,
  label,
  name
}: {
  children: ReactElement<InputHTMLAttributes<HTMLInputElement>>;
  errors?: string[];
  label: string;
  name: string;
}) {
  const id = `${name}-error`;
  return (
    <label>
      {label}
      {cloneElement(children, fieldErrorProps(errors, id))}
      <FieldError id={id} messages={errors} />
    </label>
  );
}

function FormNotice({
  message,
  status
}: {
  message: string;
  status: "idle" | "success" | "error";
}) {
  if (!message) return null;
  return (
    <p role={status === "error" ? "alert" : "status"} aria-live="polite">
      {message}
    </p>
  );
}
