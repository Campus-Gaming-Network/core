import { createFileRoute, redirect } from "@tanstack/react-router";
import { pageNoticeKey } from "../components/page-notice";
import { PageNoticeView } from "../components/page-notice-view";
import { RouteErrorView, RoutePending } from "../components/route-boundaries";
import { getAccountProfile } from "../features/account-slice/account.functions";
import { DeleteAccountForm } from "../features/account-slice/delete-account-form";
import {
  deleteAccountHead,
  deleteAccountNotices,
} from "../features/account-slice/presentation";
import { PageIntro } from "../components/page-heading";

export const Route = createFileRoute("/settings/delete-account")({
  validateSearch: (search: Record<string, unknown>) => {
    const account = pageNoticeKey(deleteAccountNotices, search.account);
    return account ? { account } : {};
  },
  loader: async ({ context }) => {
    const result = await getAccountProfile();
    if (result.status === "unauthenticated") {
      throw redirect({
        to: "/login",
        search: { next: "/settings/delete-account" },
      });
    }
    if (result.status !== "found") {
      throw new Error("Account details are unavailable");
    }
    return { publicOrigin: context.publicOrigin };
  },
  staleTime: 0,
  headers: () => ({ "cache-control": "private, no-store", vary: "Cookie" }),
  head: ({ loaderData }) => deleteAccountHead(loaderData?.publicOrigin),
  pendingComponent: DeleteAccountPending,
  errorComponent: DeleteAccountError,
  component: DeleteAccountPage,
});

function DeleteAccountPage() {
  const search = Route.useSearch();

  return (
    <>
      <PageIntro
        title="Delete account"
        lede="Permanently remove your Campus Gaming Network account."
      />
      <PageNoticeView
        notice={
          search.account ? deleteAccountNotices[search.account] : undefined
        }
      />
      <DeleteAccountForm />
    </>
  );
}

function DeleteAccountPending() {
  return <RoutePending message="Loading account settings…" />;
}

function DeleteAccountError() {
  return (
    <RouteErrorView
      eyebrow="Account settings unavailable"
      heading="We could not load your account settings."
      description="Please try again in a moment."
      showNavigation={false}
    />
  );
}
