import { Link, createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { type FormEvent } from "react";
import {
  FormErrorSummary,
  useEnhancedMutation,
} from "../components/enhanced-mutation";
import { FormField } from "../components/form-field";
import { emailInputProps } from "../features/auth-flow-slice/field-props";
import { loginProblem } from "../features/auth-flow-slice/login-help";
import { authPageHead } from "../features/auth-flow-slice/presentation";
import { login } from "../features/event-slice/auth.functions";
import { safeLocalPath } from "../safe-local-path";
import "../features/auth-flow-slice/auth-flow.css";

type LoginSearch = {
  error?: "login-failed" | "account-suspended";
  next?: string;
  reset?: "complete";
  signup?: "check-email";
};

export const Route = createFileRoute("/login")({
  loader: ({ context }) => context.publicOrigin,
  validateSearch: validateLoginSearch,
  head: ({ loaderData }) =>
    authPageHead(loaderData, {
      title: "Log in",
      description:
        "Log in to your Campus Gaming Network account to RSVP to events and manage teams.",
      path: "/login",
    }),
  component: LoginPage,
});

function validateLoginSearch(search: Record<string, unknown>): LoginSearch {
  const nextValue = firstString(search.next);
  const errorValue = firstString(search.error);
  const resetValue = firstString(search.reset);
  const signupValue = firstString(search.signup);
  const next = safeLocalPath(nextValue);

  return {
    ...(errorValue === "login-failed" || errorValue === "account-suspended"
      ? { error: errorValue }
      : {}),
    ...(next ? { next } : {}),
    ...(resetValue === "complete" ? { reset: "complete" as const } : {}),
    ...(signupValue === "check-email"
      ? { signup: "check-email" as const }
      : {}),
  };
}

function LoginPage() {
  const search = Route.useSearch();
  const notice =
    search.reset === "complete"
      ? "Password reset. Log in with your new password."
      : search.signup === "check-email"
        ? "Check your email for the verification link, then log in."
        : undefined;

  return (
    <main className="auth-page">
      <header className="auth-heading">
        <h1>Log in</h1>
        <p className="lede">
          Use the email and password you signed up with. Your email must be
          verified first.
        </p>
      </header>
      <LoginForm
        next={search.next}
        notice={notice}
        initialFailure={search.error}
      />
      <ul className="auth-footer">
        <li>
          <Link to="/forgot-password">Forgot password?</Link>
        </li>
        <li>
          Need an account? <Link to="/signup">Sign up</Link>
        </li>
      </ul>
    </main>
  );
}

function LoginForm({
  next,
  notice,
  initialFailure,
}: {
  next?: string;
  notice?: string;
  initialFailure?: LoginSearch["error"];
}) {
  const runLogin = useServerFn(login);
  const mutation = useEnhancedMutation(
    "We could not log you in. Check your details and try again.",
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

    await mutation.execute(() =>
      runLogin({
        data: {
          email: String(form.get("email") ?? ""),
          password: String(form.get("password") ?? ""),
          ...(next ? { next } : {}),
        },
      }),
    );
  }

  const failure =
    mutation.message ||
    (initialFailure === "account-suspended"
      ? "Your account is suspended."
      : initialFailure
        ? "We could not log you in. Check your details and try again."
        : "");
  const problem = loginProblem(failure);
  const emailErrors = mutation.fieldErrors.email;
  const passwordErrors = mutation.fieldErrors.password;

  return (
    <form
      action={login.url}
      className="form-stack"
      method="post"
      onSubmit={submit}
    >
      {next ? <input type="hidden" name="next" value={next} /> : null}
      {notice ? (
        <p role="status" aria-live="polite">
          {notice}
        </p>
      ) : null}
      <FormErrorSummary
        fieldErrors={mutation.fieldErrors}
        fieldIds={{
          email: "login-email-error",
          password: "login-password-error",
        }}
        message={failure}
        summaryRef={mutation.errorSummaryRef}
      />
      {problem === "suspended" ? (
        <p className="auth-help">
          You cannot log in while it is suspended.{" "}
          <Link to="/support">Contact support</Link> for help.
        </p>
      ) : problem === "mismatch" ? (
        <p className="auth-help">
          Check for typos, or{" "}
          <Link to="/forgot-password">reset your password</Link>.
        </p>
      ) : problem === "unverified" ? (
        <p className="auth-help">
          We sent a link when you signed up.{" "}
          <Link to="/auth/verify-email">Send a new verification email</Link>.
        </p>
      ) : problem === "rate-limited" ? (
        <p className="auth-help">
          Wait several minutes before the next try. If you forgot your password,{" "}
          <Link to="/forgot-password">reset it</Link> instead.
        </p>
      ) : null}
      <FormField errorId="login-email-error" errors={emailErrors} label="Email">
        <input name="email" {...emailInputProps} enterKeyHint="next" required />
      </FormField>
      <FormField
        errorId="login-password-error"
        errors={passwordErrors}
        label="Password"
      >
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          enterKeyHint="go"
          maxLength={256}
          required
        />
      </FormField>
      <button type="submit" disabled={mutation.pending}>
        {mutation.pending ? "Logging in…" : "Log in"}
      </button>
    </form>
  );
}

function firstString(value: unknown) {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value) && typeof value[0] === "string") {
    return value[0];
  }

  return undefined;
}
