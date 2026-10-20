import { Link, createFileRoute, redirect } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import type { FormEvent } from "react";
import {
  FormErrorSummary,
  useEnhancedMutation,
} from "../components/enhanced-mutation";
import { establishPrivateAuthPage } from "../features/auth-flow-slice/auth-flow.functions";
import { authPageHead } from "../features/auth-flow-slice/presentation";
import { acceptClubEditorInvite } from "../features/club-slice/club.functions";
import { validateEditorInviteSearch } from "../features/club-slice/contracts";
import "../features/auth-flow-slice/auth-flow.css";

export const Route = createFileRoute("/club-editor-invite")({
  validateSearch: validateEditorInviteSearch,
  // Accepting needs the invited account, so a visitor signs in first and
  // comes back to this link.
  beforeLoad: ({ context, location }) => {
    if (!context.hasSessionCookie) {
      throw redirect({ to: "/login", search: { next: location.href } });
    }
  },
  loader: async ({ context }) => {
    await establishPrivateAuthPage();
    return context.publicOrigin;
  },
  head: ({ loaderData }) =>
    authPageHead(loaderData, {
      title: "Edit a club",
      description: "Accept an invitation to edit a club's page.",
      path: "/club-editor-invite",
      noIndex: true,
    }),
  headers: () => ({
    "cache-control": "private, no-store",
    "referrer-policy": "no-referrer",
  }),
  component: ClubEditorInvitePage,
});

const failures = {
  invalid:
    "That invitation is invalid, has expired, or was withdrawn. Ask the club's owner to send a new one.",
  "wrong-account":
    "That invitation was sent to another email address. Sign in with the address it was sent to, then open the link again.",
  failed: "We could not accept the invitation. Please try again.",
} as const;

/**
 * The page an editor invite email links to. Opening it changes nothing: the
 * person selects Accept, so a mail scanner that follows links cannot use the
 * token.
 */
function ClubEditorInvitePage() {
  const search = Route.useSearch();
  const runAccept = useServerFn(acceptClubEditorInvite);
  const mutation = useEnhancedMutation(failures.failed);
  const usable = Boolean(search.token) && !search.result;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await mutation.execute(() => runAccept({ data }));
  }

  return (
    <main className="auth-page">
      <header className="auth-heading">
        <h1>{usable ? "Edit a club" : "We could not use that invitation"}</h1>
      </header>
      {search.result ? (
        <p role="alert">{failures[search.result]}</p>
      ) : !search.token ? (
        <p role="alert">{failures.invalid}</p>
      ) : null}
      <FormErrorSummary
        fieldErrors={mutation.fieldErrors}
        message={mutation.message}
        summaryRef={mutation.errorSummaryRef}
      />
      {usable && search.token ? (
        <>
          <p className="lede">You have been asked to help run a club.</p>
          <form
            action={acceptClubEditorInvite.url}
            className="form-stack"
            method="post"
            onSubmit={submit}
          >
            <input name="token" type="hidden" value={search.token} />
            <p className="form-help">
              As an editor you can change the club&apos;s page and remove
              members. Its owners can remove you, and you can leave at any time.
            </p>
            <div className="form-actions">
              <button disabled={mutation.pending} type="submit">
                Accept invitation
              </button>
            </div>
          </form>
        </>
      ) : (
        <Link className="button button--primary" to="/clubs">
          Browse clubs
        </Link>
      )}
    </main>
  );
}
