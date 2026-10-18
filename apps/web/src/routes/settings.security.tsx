import { createFileRoute, redirect } from "@tanstack/react-router";
import { pageNoticeKey } from "../components/page-notice";
import { PageNoticeView } from "../components/page-notice-view";
import { RouteErrorView, RoutePending } from "../components/route-boundaries";
import { getAccountProfile } from "../features/account-slice/account.functions";
import {
  securityNotices,
  securitySettingsHead,
} from "../features/account-slice/security";
import {
  ChangeEmailForm,
  ChangePasswordForm,
} from "../features/account-slice/security-forms";

export const Route = createFileRoute("/settings/security")({
  validateSearch: (search: Record<string, unknown>) => {
    const security = pageNoticeKey(securityNotices, search.security);
    return security ? { security } : {};
  },
  loader: async ({ context }) => {
    const result = await getAccountProfile();
    if (result.status === "unauthenticated") {
      throw redirect({ to: "/login", search: { next: "/settings/security" } });
    }
    if (result.status !== "found") {
      throw new Error("Account details are unavailable");
    }
    return { email: result.profile.email, publicOrigin: context.publicOrigin };
  },
  staleTime: 0,
  headers: () => ({ "cache-control": "private, no-store", vary: "Cookie" }),
  head: ({ loaderData }) => securitySettingsHead(loaderData?.publicOrigin),
  pendingComponent: SecurityPending,
  errorComponent: SecurityError,
  component: SecuritySettingsPage,
});

function SecuritySettingsPage() {
  const { email } = Route.useLoaderData();
  const { security } = Route.useSearch();
  const notice = security ? securityNotices[security] : undefined;
  // An error that belongs to a form shows in that form, next to its field.
  const pageNotice = notice && !("form" in notice) ? notice : undefined;

  return (
    <>
      <section className="page-heading">
        <div>
          <h1>Email and password</h1>
          <p className="lede">
            Change the email and password you sign in with.
          </p>
        </div>
      </section>
      <PageNoticeView notice={pageNotice} />
      {/* Each answer remounts the forms, so a saved password does not stay
          typed in. */}
      <div className="security-forms" key={security ?? "fresh"}>
        <ChangePasswordForm notice={security} />
        <ChangeEmailForm currentEmail={email} notice={security} />
      </div>
    </>
  );
}

function SecurityPending() {
  return <RoutePending message="Loading your account…" />;
}

function SecurityError() {
  return (
    <RouteErrorView
      eyebrow="Account unavailable"
      heading="We could not load your account."
    />
  );
}
