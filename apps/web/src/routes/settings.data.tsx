import { Link, createFileRoute, redirect } from "@tanstack/react-router";
import { pageNoticeKey } from "../components/page-notice";
import { PageNoticeView } from "../components/page-notice-view";
import { RouteErrorView, RoutePending } from "../components/route-boundaries";
import { getAccountProfile } from "../features/account-slice/account.functions";
import {
  dataExportNotices,
  dataSettingsHead,
} from "../features/account-slice/presentation";

export const Route = createFileRoute("/settings/data")({
  validateSearch: (search: Record<string, unknown>) => {
    const notice = pageNoticeKey(dataExportNotices, search.export);
    return notice ? { export: notice } : {};
  },
  loader: async ({ context }) => {
    const result = await getAccountProfile();
    if (result.status === "unauthenticated") {
      throw redirect({ to: "/login", search: { next: "/settings/data" } });
    }
    if (result.status !== "found") {
      throw new Error("Account details are unavailable");
    }
    return { publicOrigin: context.publicOrigin };
  },
  staleTime: 0,
  headers: () => ({ "cache-control": "private, no-store", vary: "Cookie" }),
  head: ({ loaderData }) => dataSettingsHead(loaderData?.publicOrigin),
  pendingComponent: DataSettingsPending,
  errorComponent: DataSettingsError,
  component: DataSettingsPage,
});

/**
 * Where someone gets a copy of their data, finds where to correct it, and
 * reaches account deletion. The download is a plain form post that the
 * browser saves as a file, so it needs no JavaScript.
 */
function DataSettingsPage() {
  const search = Route.useSearch();

  return (
    <>
      <section className="page-heading">
        <div>
          <h1>Your data</h1>
          <p className="lede">
            Download a copy of what Campus Gaming Network holds about you, and
            find where to correct it.
          </p>
        </div>
      </section>
      <PageNoticeView
        notice={search.export ? dataExportNotices[search.export] : undefined}
      />

      <section aria-labelledby="export-heading" className="panel">
        <h2 id="export-heading">Download your data</h2>
        <p>
          The file covers your account and profile, the schools you follow, your
          game lists, teams, the events you organize, RSVP to, or marked as
          interesting, your support requests and reports, notifications, the
          Terms and Privacy versions you accepted, and your sign-in sessions. It
          is a JSON file you can open in a text editor.
        </p>
        <form action="/api/account/export" className="form-stack" method="post">
          <label>
            Current password
            <input
              autoComplete="current-password"
              name="current_password"
              required
              type="password"
            />
          </label>
          <p className="form-help">
            We ask for your password because the file includes your email
            address and activity. Each download is recorded.
          </p>
          <div className="form-actions">
            <button type="submit">Download your data</button>
          </div>
        </form>
      </section>

      <section aria-labelledby="correct-heading" className="panel">
        <h2 id="correct-heading">Correct your data</h2>
        <ul className="data-corrections">
          <li>
            Your name, bio, links, game lists, and whether you appear in member
            lists: <Link to="/settings/profile">Profile settings</Link>
          </li>
          <li>
            Your email address and password:{" "}
            <Link to="/settings/security">Email and password</Link>
          </li>
          <li>
            Your home school, or anything you cannot change yourself, such as a
            support request or report:{" "}
            <Link search={{ topic: "privacy" }} to="/support">
              Send a privacy request
            </Link>
          </li>
        </ul>
      </section>

      <section aria-labelledby="delete-heading" className="panel">
        <h2 id="delete-heading">Delete your account</h2>
        <p>
          Deleting your account removes your profile and personal data.{" "}
          <Link to="/settings/delete-account">Delete account</Link>
        </p>
      </section>
    </>
  );
}

function DataSettingsPending() {
  return <RoutePending message="Loading account settings…" />;
}

function DataSettingsError() {
  return (
    <RouteErrorView
      eyebrow="Account settings unavailable"
      heading="We could not load your account settings."
      description="Please try again in a moment."
      showNavigation={false}
    />
  );
}
