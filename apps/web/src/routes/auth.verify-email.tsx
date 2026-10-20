import { Link, createFileRoute } from "@tanstack/react-router";
import {
  ResendVerificationForm,
  VerifyEmailForm,
} from "../features/auth-flow-slice/auth-forms";
import { validateVerifyEmailSearch } from "../features/auth-flow-slice/contracts";
import { establishPrivateAuthPage } from "../features/auth-flow-slice/auth-flow.functions";
import { authPageHead } from "../features/auth-flow-slice/presentation";
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
  const verified = search.verified === "complete";
  const hasUsableToken = Boolean(search.token) && !search.error;
  const bareVisit = !search.token && !search.error;

  return (
    <main className="auth-page">
      <header className="auth-heading">
        <h1>
          {verified
            ? "Your email is verified"
            : hasUsableToken
              ? "Confirm your email"
              : bareVisit
                ? "Send a new verification email"
                : "We could not verify that link"}
        </h1>
      </header>
      {verified ? (
        <>
          <p role="status">Your email is verified. You can log in now.</p>
          <Link className="button button--primary" to="/login">
            Log in
          </Link>
        </>
      ) : hasUsableToken && search.token ? (
        <>
          <p className="lede">
            Almost there. Select Verify email to confirm your address.
          </p>
          <VerifyEmailForm token={search.token} />
        </>
      ) : (
        <>
          {bareVisit ? (
            <p className="lede">
              Enter the email you signed up with and we will send another
              verification link.
            </p>
          ) : (
            <p role="alert">
              {search.error
                ? "That link is invalid or has expired. Enter your email to get a new one."
                : "This verification link is incomplete. Enter your email to get a new one."}
            </p>
          )}
          <ResendVerificationForm initialStatus={search.resend} />
        </>
      )}
    </main>
  );
}
