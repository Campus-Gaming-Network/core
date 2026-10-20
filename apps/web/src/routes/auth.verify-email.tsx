import { Link, createFileRoute } from "@tanstack/react-router";
import {
  ResendVerificationForm,
  VerifyEmailForm,
} from "../features/auth-flow-slice/auth-forms";
import { validateVerifyEmailSearch } from "../features/auth-flow-slice/contracts";
import { establishPrivateAuthPage } from "../features/auth-flow-slice/auth-flow.functions";
import {
  authPageHead,
  verifyEmailCopy,
} from "../features/auth-flow-slice/presentation";
import "../features/auth-flow-slice/auth-flow.css";

const description = "Confirm your email address for Campus Gaming Network.";

export const Route = createFileRoute("/auth/verify-email")({
  validateSearch: validateVerifyEmailSearch,
  loader: async ({ context }) => {
    await establishPrivateAuthPage();
    return context.publicOrigin;
  },
  head: ({ loaderData }) =>
    authPageHead(loaderData, {
      title: "Verify email",
      description,
      path: "/auth/verify-email",
      noIndex: true,
    }),
  headers: () => ({
    "cache-control": "private, no-store",
    "referrer-policy": "no-referrer",
  }),
  component: VerifyEmailPage,
});

function VerifyEmailPage() {
  const search = Route.useSearch();
  const copy = verifyEmailCopy(search);

  return (
    <main className="auth-page">
      <header className="auth-heading">
        <h1>{copy.heading}</h1>
      </header>
      {search.verified === "complete" ? (
        <>
          <p role="status">{copy.message.text}</p>
          <Link className="button button--primary" to="/login">
            Log in
          </Link>
        </>
      ) : search.token && !search.error ? (
        <>
          <p className="lede">{copy.message.text}</p>
          <VerifyEmailForm token={search.token} />
        </>
      ) : (
        <>
          {copy.message.role === "alert" ? (
            <p role="alert">{copy.message.text}</p>
          ) : (
            <p className="lede">{copy.message.text}</p>
          )}
          <ResendVerificationForm initialStatus={search.resend} />
        </>
      )}
    </main>
  );
}
