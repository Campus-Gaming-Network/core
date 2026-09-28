import { createFileRoute } from "@tanstack/react-router";
import { safeReturnPath } from "../features/catalog/contracts";
import { completeStepUp } from "../server/step-up.server";

export const Route = createFileRoute("/step-up")({
  validateSearch: (search: Record<string, unknown>) => ({
    return: safeReturnPath(search.return),
    ...(search.error === "failed" ? { error: "failed" as const } : {}),
  }),
  server: {
    handlers: {
      POST: ({ request }) => completeStepUp(request),
    },
  },
  head: () => ({ meta: [{ title: "Confirm identity | CGN Admin Console" }] }),
  component: StepUpPage,
});

function StepUpPage() {
  const search = Route.useSearch();

  return (
    <div className="page-stack detail-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Recent authentication</p>
          <h1>Confirm your identity</h1>
          <p>
            Suspending accounts and changing site-admin access need a sign-in
            from the last 10 minutes. Continue to sign in again through
            Cloudflare Access; you will return to the page you came from.
          </p>
        </div>
      </header>
      {search.error ? (
        <p className="notice notice--error" role="alert">
          Your identity could not be confirmed. Sign in again when Cloudflare
          Access asks, then retry.
        </p>
      ) : null}
      <form action="/step-up" className="moderation-form" method="post">
        <input name="return" type="hidden" value={search.return} />
        <button type="submit">Confirm identity</button>
      </form>
      <p>
        <a href={search.return}>Cancel and go back</a>
      </p>
    </div>
  );
}
