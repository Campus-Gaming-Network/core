import { Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  cloneElement,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from "react";
import {
  FieldError,
  FormErrorSummary,
  fieldErrorProps,
} from "../../components/enhanced-mutation";
import { FormField } from "../../components/form-field";
import { FormSection } from "../../components/form-section";
import type { SchoolDTO } from "../school-slice/contracts";
import type { SignupPolicies } from "./contracts";
import {
  forgotPassword,
  resendVerification,
  resetPassword,
  signup,
  verifyEmail,
} from "./auth-flow.functions";
import { emailInputProps, passwordHint, passwordRules } from "./field-props";
import { SchoolSearchSelect } from "../../components/school-search-select";
import { detectTimeZone } from "./timezone";
import { useAuthMutation } from "./use-auth-mutation";

export function SignupForm({
  schools,
  selectedSchoolId,
  initialQuery,
  initialSearchFailed,
  initialStatus,
  policies,
}: {
  schools: SchoolDTO[];
  selectedSchoolId?: string;
  initialQuery?: string;
  initialSearchFailed?: boolean;
  initialStatus?: "failed";
  /** Undefined when the current versions could not be read. */
  policies: SignupPolicies | undefined;
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
          home_school_id: "home_school_id-error",
          age_confirmed: "age_confirmed-error",
          policies_accepted: "policies_accepted-error",
        }}
        status={
          mutation.message
            ? mutation.status
            : initialStatus === "failed"
              ? "error"
              : "idle"
        }
        message={
          mutation.message ||
          (initialStatus === "failed"
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
          <input
            name="name"
            autoComplete="name"
            autoCapitalize="words"
            enterKeyHint="next"
            required
            maxLength={120}
          />
        </FormField>
        <FormField
          errorId="email-error"
          errors={mutation.fieldErrors.email}
          label="Email"
        >
          <input
            name="email"
            {...emailInputProps}
            enterKeyHint="next"
            required
          />
        </FormField>
        <HintedField
          errorId="password-error"
          errors={mutation.fieldErrors.password}
          hint={passwordHint}
          label="Password"
        >
          <input
            name="password"
            type="password"
            autoComplete="new-password"
            enterKeyHint="next"
            {...passwordRules}
            required
          />
        </HintedField>
        <DeviceTimeZone />
      </FormSection>
      <FormSection
        title="Your campus"
        description="Start typing the name of the school you attend, then choose it."
      >
        <div>
          <SchoolSearchSelect
            defaultSchool={schools.find(
              (school) => school.id === selectedSchoolId,
            )}
            defaultValue={selectedSchoolId ?? ""}
            describedBy={
              mutation.fieldErrors.home_school_id
                ? "home_school_id-error"
                : undefined
            }
            emptyLabel="Choose your school"
            initialQuery={initialQuery ?? ""}
            initialSchools={schools}
            initialSearchFailed={Boolean(initialSearchFailed)}
            invalid={Boolean(mutation.fieldErrors.home_school_id?.length)}
            label="Your school"
            name="home_school_id"
            required
            valueField="id"
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
          <span>I confirm I am 18 or older. CGN is for adults only.</span>
        </label>
        <FieldError
          id="age_confirmed-error"
          messages={mutation.fieldErrors.age_confirmed}
        />
      </FormSection>
      <FormSection
        title="Terms and privacy"
        description="Read both before you create an account. The links open the exact versions you are accepting."
      >
        {policies ? (
          <>
            <input
              name="terms_version"
              type="hidden"
              value={policies.termsVersion}
            />
            <input
              name="privacy_version"
              type="hidden"
              value={policies.privacyVersion}
            />
            <label className="checkbox-field">
              <input
                type="checkbox"
                name="policies_accepted"
                required
                {...fieldErrorProps(
                  mutation.fieldErrors.policies_accepted,
                  "policies_accepted-error",
                )}
              />
              <span>
                I agree to the{" "}
                <Link
                  rel="noopener"
                  search={{ version: policies.termsVersion }}
                  target="_blank"
                  to="/terms"
                >
                  Terms
                  <NewTabNote />
                </Link>{" "}
                and acknowledge the{" "}
                <Link
                  rel="noopener"
                  search={{ version: policies.privacyVersion }}
                  target="_blank"
                  to="/privacy"
                >
                  Privacy Policy
                  <NewTabNote />
                </Link>
                .
              </span>
            </label>
            <FieldError
              id="policies_accepted-error"
              messages={mutation.fieldErrors.policies_accepted}
            />
          </>
        ) : (
          <p role="alert">
            Sign up is unavailable right now because the Terms and Privacy
            Policy could not be loaded. Reload the page to try again.
          </p>
        )}
      </FormSection>
      <div className="form-actions">
        <button type="submit" disabled={mutation.pending || !policies}>
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
        <input name="email" {...emailInputProps} enterKeyHint="send" required />
      </FormField>
      <button type="submit" disabled={mutation.pending}>
        {mutation.pending ? "Sending…" : "Send reset link"}
      </button>
      {mutation.status === "success" || initialStatus === "sent" ? (
        <p className="auth-help">
          The email can take a few minutes. Check your spam folder if it does
          not show up. You can send another link from this page.
        </p>
      ) : null}
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
      <HintedField
        errorId="password-error"
        errors={mutation.fieldErrors.password}
        hint={passwordHint}
        label="New password"
      >
        <input
          name="password"
          type="password"
          autoComplete="new-password"
          enterKeyHint="go"
          {...passwordRules}
          required
        />
      </HintedField>
      <button type="submit" disabled={mutation.pending}>
        {mutation.pending ? "Resetting…" : "Reset password"}
      </button>
      {mutation.status === "error" ? (
        <p className="auth-help">
          Reset links work once and expire.{" "}
          <Link to="/forgot-password">Request a new link</Link>.
        </p>
      ) : null}
    </form>
  );
}

/**
 * Replaces the signup form once the account exists, so the next step is the
 * only thing on the page.
 */
export function SignupConfirmation({ email }: { email: string | null }) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  // The form's submit button sits far down the page, and arriving here does not
  // change the path, so the root layout's focus handling does not run.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <>
      <header className="auth-heading">
        <h1 ref={headingRef} tabIndex={-1}>
          Check your email
        </h1>
        <p className="lede">
          {email ? (
            <>
              We sent a verification link to <strong>{email}</strong>.
            </>
          ) : (
            "We sent a verification link to the address you signed up with."
          )}{" "}
          Open it to verify your email, then log in.
        </p>
      </header>
      <section className="form-stack" aria-labelledby="resend-heading">
        <h2 id="resend-heading">Did not get it?</h2>
        <p>
          Check your spam folder, or send the link again. If the address above
          is wrong, <Link to="/signup">sign up again</Link> with the right one.
        </p>
        <ResendVerificationForm defaultEmail={email ?? undefined} />
      </section>
    </>
  );
}

export function ResendVerificationForm({
  initialStatus,
  defaultEmail,
}: {
  initialStatus?: "sent" | "failed";
  defaultEmail?: string;
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
        <input
          name="email"
          {...emailInputProps}
          defaultValue={defaultEmail}
          enterKeyHint="send"
          required
        />
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

  const router = useRouter();
  const succeeded = mutation.status === "success";

  // Move to the same page a form post without JavaScript lands on, so the
  // heading says "verified" and the token leaves the address bar.
  useEffect(() => {
    if (!succeeded) return;
    void router.navigate({
      to: "/auth/verify-email",
      search: { verified: "complete" },
      replace: true,
    });
  }, [succeeded, router]);

  if (succeeded) {
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

/**
 * A labeled control with a line of help under it. The help is tied to the
 * control with `aria-describedby`, next to any error. FormField has no help
 * line, so this repeats its markup.
 */
function HintedField({
  children,
  errorId,
  errors,
  hint,
  hintId: givenHintId,
  label,
}: {
  children: ReactElement<{
    "aria-describedby"?: string;
    "aria-labelledby"?: string;
    "aria-invalid"?: boolean;
  }>;
  errorId: string;
  errors?: string[];
  hint: ReactNode;
  hintId?: string;
  label: string;
}) {
  const labelId = useId();
  const ownHintId = useId();
  const hintId = givenHintId ?? ownHintId;
  const errorProps = fieldErrorProps(errors, errorId);
  return (
    <label>
      <span id={labelId}>{label}</span>
      {cloneElement(children, {
        "aria-labelledby": labelId,
        ...errorProps,
        "aria-describedby":
          [errorProps["aria-describedby"], hintId].filter(Boolean).join(" ") ||
          undefined,
      })}
      <FieldError id={errorId} messages={errors} />
      <span className="form-help" id={hintId}>
        {hint}
      </span>
    </label>
  );
}

const defaultTimeZone = "America/Los_Angeles";

/**
 * The time zone, sent with the signup without asking: the device's own once
 * the page is interactive, Pacific Time without JavaScript. It can be changed
 * later in profile settings, which offer a pick list.
 */
function DeviceTimeZone() {
  const [zone, setZone] = useState(defaultTimeZone);
  useEffect(() => {
    const found = detectTimeZone();
    if (found) setZone(found);
  }, []);
  return <input name="timezone" type="hidden" value={zone} />;
}

/** Warns assistive technology that a link leaves the signup form. */
function NewTabNote() {
  return <span className="visually-hidden"> (opens in a new tab)</span>;
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
