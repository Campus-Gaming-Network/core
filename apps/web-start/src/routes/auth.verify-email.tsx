import { Link, createFileRoute } from "@tanstack/react-router";
import {
  ResendVerificationForm,
  VerifyEmailForm
} from "../features/auth-flow-slice/auth-forms";
import {
  validateVerifyEmailSearch
} from "../features/auth-flow-slice/contracts";
import { establishPrivateAuthPage } from "../features/auth-flow-slice/auth-flow.functions";
import { authPageHead } from "../features/auth-flow-slice/presentation";

const description = "Confirm your email address for Campus Gaming Network.";

export const Route = createFileRoute("/auth/verify-email")({
  validateSearch: validateVerifyEmailSearch,
  loader: async ({ context }) => {
    await establishPrivateAuthPage();
    return context.publicOrigin;
  },
  head: ({ loaderData }) => authPageHead(loaderData, {
    title: "Verify email",
    description,
    path: "/auth/verify-email",
    noIndex: true
  }),
  headers: () => ({
    "cache-control": "private, no-store",
    "referrer-policy": "no-referrer"
  }),
  component: VerifyEmailPage
});

function VerifyEmailPage() {
  const search = Route.useSearch();
  const verified = search.verified === "complete";
  const hasUsableToken = Boolean(search.token) && !search.error;

  return (
    <main className="auth-page">
      <section className="page-heading">
        <p className="eyebrow">Email verification</p>
        <h1>
          {verified
            ? "Your email is verified."
            : hasUsableToken
              ? "Confirm your email."
              : "We could not verify that link."}
        </h1>
      </section>
      {verified ? (
        <p role="status">
          Your email is verified. <Link to="/login">Log in</Link> to continue.
        </p>
      ) : hasUsableToken && search.token ? (
        <>
          <p className="lede">Select Verify email to finish confirming your address.</p>
          <VerifyEmailForm token={search.token} />
        </>
      ) : (
        <>
          <p role="alert">
            {search.error
              ? "That link is invalid or has expired."
              : "This verification link is missing its token."}
          </p>
          <ResendVerificationForm initialStatus={search.resend} />
        </>
      )}
    </main>
  );
}
