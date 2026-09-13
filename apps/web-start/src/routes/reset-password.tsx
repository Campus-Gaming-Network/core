import { Link, createFileRoute } from "@tanstack/react-router";
import { ResetPasswordForm } from "../features/auth-flow-slice/auth-forms";
import {
  validateResetPasswordSearch
} from "../features/auth-flow-slice/contracts";
import { establishPrivateAuthPage } from "../features/auth-flow-slice/auth-flow.functions";
import { authPageHead } from "../features/auth-flow-slice/presentation";

const description =
  "Choose a new password for your Campus Gaming Network account.";

export const Route = createFileRoute("/reset-password")({
  validateSearch: validateResetPasswordSearch,
  loader: async ({ context }) => {
    await establishPrivateAuthPage();
    return context.publicOrigin;
  },
  head: ({ loaderData }) => authPageHead(loaderData, {
    title: "Reset password",
    description,
    path: "/reset-password",
    noIndex: true
  }),
  headers: () => ({
    "cache-control": "private, no-store",
    "referrer-policy": "no-referrer"
  }),
  component: ResetPasswordPage
});

function ResetPasswordPage() {
  const search = Route.useSearch();
  return (
    <main className="auth-page">
      <section className="page-heading">
        <p className="eyebrow">Password reset</p>
        <h1>Choose a new password.</h1>
      </section>
      {search.token ? (
        <ResetPasswordForm token={search.token} />
      ) : (
        <p role="alert">
          {search.reset === "failed"
            ? "That reset link is invalid or has expired. "
            : "This reset link is missing its token. "}
          Request a new link from <Link to="/forgot-password">forgot password</Link>.
        </p>
      )}
    </main>
  );
}
