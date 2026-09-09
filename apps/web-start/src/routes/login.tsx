import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { login } from "../features/event-slice/auth.functions";

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
        content: `${loaderData ?? "http://localhost:3100"}/login`
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
  const next = safeRedirect(nextValue);

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
        Need an account? <a href="/signup">Sign up</a>
        {" | "}
        <a href="/forgot-password">Forgot password?</a>
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
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setFailed(false);

    try {
      const form = new FormData(event.currentTarget);
      const result = await runLogin({
        data: {
          email: String(form.get("email") ?? ""),
          password: String(form.get("password") ?? ""),
          ...(next ? { next } : {})
        }
      });

      if (result.status !== "success") {
        setFailed(true);
        return;
      }

      await router.invalidate();
      await router.navigate({ href: result.redirectTo, replace: true });
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

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
      {failed || initialFailure ? (
        <p role="alert" aria-live="polite">
          We could not log you in. Check your details and try again.
        </p>
      ) : null}
      <label>
        Email
        <input
          name="email"
          type="email"
          autoComplete="email"
          required
          aria-invalid={failed || undefined}
        />
      </label>
      <label>
        Password
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={failed || undefined}
        />
      </label>
      <button type="submit" disabled={pending}>
        {pending ? "Logging in…" : "Log in"}
      </button>
    </form>
  );
}

function safeRedirect(value: string | undefined) {
  if (
    value &&
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.includes("\\")
  ) {
    return value;
  }

  return undefined;
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
