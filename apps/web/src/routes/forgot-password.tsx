import { Link, createFileRoute } from "@tanstack/react-router";
import { ForgotPasswordForm } from "../features/auth-flow-slice/auth-forms";
import { validateForgotPasswordSearch } from "../features/auth-flow-slice/contracts";
import { authPageHead } from "../features/auth-flow-slice/presentation";
import "../features/auth-flow-slice/auth-flow.css";

const description =
  "Request a password reset link for your Campus Gaming Network account.";

export const Route = createFileRoute("/forgot-password")({
  validateSearch: validateForgotPasswordSearch,
  loader: ({ context }) => context.publicOrigin,
  head: ({ loaderData }) =>
    authPageHead(loaderData, {
      title: "Forgot password",
      description,
      path: "/forgot-password",
      noIndex: true,
    }),
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const search = Route.useSearch();
  return (
    <main className="auth-page">
      <header className="auth-heading">
        <h1>Reset your password</h1>
        <p className="lede">
          Enter your email and we will send a reset link if the account exists.
        </p>
      </header>
      <ForgotPasswordForm initialStatus={search.request} />
      <p className="auth-footer">
        Remembered it? <Link to="/login">Log in</Link>
      </p>
    </main>
  );
}
