import { Link, createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { type FormEvent } from "react";
import {
  FieldError,
  fieldErrorProps,
  useEnhancedMutation
} from "../components/enhanced-mutation";
import { login } from "../features/event-slice/auth.functions";
import { safeLocalPath } from "../safe-local-path";

type LoginSearch = {
  error?: "login-failed";
  next?: string;
  reset?: "complete";
  signup?: "check-email";
};

export const Route = createFileRoute("/login")({
  loader: ({ context }) => context.publicOrigin,
  validateSearch: validateLoginSearch,
  head: ({ loaderData }) => ({
    meta: [
      { title: "Log in | Campus Gaming Network" },
      {
        name: "description",
        content:
          "Log in to your Campus Gaming Network account to RSVP to events and manage teams."
      },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "Campus Gaming Network" },
      {
        property: "og:title",
        content: "Log in | Campus Gaming Network"
      },
      {
        property: "og:description",
        content:
          "Log in to your Campus Gaming Network account to RSVP to events and manage teams."
      },
      {
        property: "og:url",
        content: `${loaderData ?? "http://localhost:3000"}/login`
      },
      { name: "twitter:card", content: "summary" },
      {
        name: "twitter:title",
        content: "Log in | Campus Gaming Network"
      },
      {
        name: "twitter:description",
        content:
          "Log in to your Campus Gaming Network account to RSVP to events and manage teams."
      }
    ]
  }),
  component: LoginPage
});

export function validateLoginSearch(search: Record<string, unknown>): LoginSearch {
  const nextValue = firstString(search.next);
  const errorValue = firstString(search.error);
  const resetValue = firstString(search.reset);
  const signupValue = firstString(search.signup);
  const next = safeLocalPath(nextValue);

  return {
    ...(errorValue === "login-failed"
      ? { error: "login-failed" as const }
      : {}),
    ...(next ? { next } : {}),
    ...(resetValue === "complete" ? { reset: "complete" as const } : {}),
    ...(signupValue === "check-email"
      ? { signup: "check-email" as const }
      : {})
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
      <section className="page-heading">
        <p className="eyebrow">Log in</p>
        <h1>Welcome back.</h1>
        <p className="lede">
          Use the account you verified to manage your profile and follow
          schools.
        </p>
      </section>
      <LoginForm
        next={search.next}
        notice={notice}
        initialFailure={search.error === "login-failed"}
      />
      <p className="form-footer">
        Need an account? <Link to="/signup">Sign up</Link>
        {" | "}
        <Link to="/forgot-password">Forgot password?</Link>
      </p>
    </main>
  );
}

function LoginForm({
  next,
  notice,
  initialFailure
}: {
  next?: string;
  notice?: string;
  initialFailure: boolean;
}) {
  const runLogin = useServerFn(login);
  const mutation = useEnhancedMutation(
    "We could not log you in. Check your details and try again."
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

    await mutation.execute(() =>
      runLogin({
        data: {
          email: String(form.get("email") ?? ""),
          password: String(form.get("password") ?? ""),
          ...(next ? { next } : {})
        }
      })
    );
  }

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
      {mutation.message || initialFailure ? (
        <p role="alert" aria-live="polite">
          {mutation.message ||
            "We could not log you in. Check your details and try again."}
        </p>
      ) : null}
      <label>
        Email
        <input
          name="email"
          type="email"
          autoComplete="email"
          maxLength={320}
          required
          {...fieldErrorProps(emailErrors, "login-email-error")}
        />
        <FieldError id="login-email-error" messages={emailErrors} />
      </label>
      <label>
        Password
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          maxLength={256}
          required
          {...fieldErrorProps(passwordErrors, "login-password-error")}
        />
        <FieldError id="login-password-error" messages={passwordErrors} />
      </label>
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
