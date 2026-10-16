import { Link, createFileRoute } from "@tanstack/react-router";
import { ResetPasswordForm } from "../features/auth-flow-slice/auth-forms";
import { validateResetPasswordSearch } from "../features/auth-flow-slice/contracts";
import { establishPrivateAuthPage } from "../features/auth-flow-slice/auth-flow.functions";
import { authPageHead } from "../features/auth-flow-slice/presentation";
import "../features/auth-flow-slice/auth-flow.css";

const description =
  "Choose a new password for your Campus Gaming Network account.";

export const Route = createFileRoute("/reset-password")({
  validateSearch: validateResetPasswordSearch,
  loader: async ({ context }) => {
    await establishPrivateAuthPage();
    return context.publicOrigin;
  },
  head: ({ loaderData }) =>
    authPageHead(loaderData, {
      title: "Reset password",
      description,
      path: "/reset-password",
      noIndex: true,
    }),
  headers: () => ({
    "cache-control": "private, no-store",
    "referrer-policy": "no-referrer",
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const search = Route.useSearch();
  return (
    <main className="auth-page">
      <header className="auth-heading">
        <h1>Choose a new password</h1>
        {search.token ? (
          <p className="lede">
            You will log in with it next. Pick one you do not use anywhere else.
          </p>
        ) : null}
      </header>
      {search.token ? (
        <ResetPasswordForm token={search.token} />
      ) : (
        <>
          <p role="alert">
            {search.reset === "failed"
              ? "That reset link is invalid or has expired. "
              : "This reset link is incomplete. "}
            Reset links work once and expire, so you need a new one.
          </p>
          <Link className="button button--primary" to="/forgot-password">
            Request a new link
          </Link>
        </>
      )}
    </main>
  );
}
