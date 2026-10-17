import { Link, createFileRoute } from "@tanstack/react-router";
import { establishPrivateAuthPage } from "../features/auth-flow-slice/auth-flow.functions";
import { authPageHead } from "../features/auth-flow-slice/presentation";
import { ConfirmEmailChangeForm } from "../features/account-slice/confirm-email-change-form";
import "../features/auth-flow-slice/auth-flow.css";

type ConfirmEmailChangeSearch = {
  token?: string;
  changed?: "complete";
  error?: "invalid-link";
};

export const Route = createFileRoute("/confirm-email-change")({
  validateSearch: (
    search: Record<string, unknown>,
  ): ConfirmEmailChangeSearch => ({
    ...(typeof search.token === "string" && search.token.length <= 512
      ? { token: search.token }
      : {}),
    ...(search.changed === "complete" ? { changed: "complete" as const } : {}),
    ...(search.error === "invalid-link"
      ? { error: "invalid-link" as const }
      : {}),
  }),
  loader: async ({ context }) => {
    await establishPrivateAuthPage();
    return context.publicOrigin;
  },
  head: ({ loaderData }) =>
    authPageHead(loaderData, {
      title: "Confirm new email",
      description: "Confirm the new email address for your account.",
      path: "/confirm-email-change",
      noIndex: true,
    }),
  headers: () => ({
    "cache-control": "private, no-store",
    "referrer-policy": "no-referrer",
  }),
  component: ConfirmEmailChangePage,
});

/**
 * The page the link sent to a new address opens. Following the link changes
 * nothing by itself: the person selects Confirm, so a mail scanner that opens
 * links cannot use the token.
 */
function ConfirmEmailChangePage() {
  const search = Route.useSearch();
  const changed = search.changed === "complete";
  const usable = Boolean(search.token) && !search.error;

  return (
    <main className="auth-page">
      <header className="auth-heading">
        <h1>
          {changed
            ? "Your email is changed"
            : usable
              ? "Confirm your new email"
              : "We could not change your email"}
        </h1>
      </header>
      {changed ? (
        <>
          <p role="status">
            Your account now uses this address. Sign in with it from now on.
          </p>
          <Link className="button button--primary" to="/settings/security">
            Go to settings
          </Link>
        </>
      ) : usable && search.token ? (
        <>
          <p className="lede">
            Select Confirm email to start using this address for your account.
          </p>
          <ConfirmEmailChangeForm token={search.token} />
        </>
      ) : (
        <>
          <p role="alert">
            That link is invalid or has expired. Links work once, and a newer
            request replaces older links.
          </p>
          <Link className="button button--primary" to="/settings/security">
            Request a new link
          </Link>
        </>
      )}
    </main>
  );
}
