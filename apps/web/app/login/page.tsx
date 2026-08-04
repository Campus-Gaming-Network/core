import Link from "next/link";
import { LoginForm } from "../../components/auth-forms";
import { pageMetadata } from "../../lib/metadata";

export const metadata = pageMetadata({
  title: "Log in",
  description:
    "Log in to your Campus Gaming Network account to RSVP to events and manage teams.",
  path: "/login"
});

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function LoginPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const resetComplete = param(params.reset) === "complete";
  const signupNotice =
    param(params.signup) === "check-email"
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
        next={param(params.next)}
        notice={
          resetComplete
            ? "Password reset. Log in with your new password."
            : signupNotice
        }
      />
      <p className="form-footer">
        Need an account? <Link className="link" href="/signup">Sign up</Link>
        {" | "}
        <Link className="link" href="/forgot-password">Forgot password?</Link>
      </p>
    </main>
  );
}

function param(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}
