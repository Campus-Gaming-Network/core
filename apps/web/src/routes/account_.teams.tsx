import {
  createFileRoute,
  redirect,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { ButtonLink } from "../components/button-link";
import { PageHeading } from "../components/page-heading";
import { RouteErrorView, RoutePending } from "../components/route-boundaries";
import { getAccountDashboard } from "../features/account-slice/account.functions";
import { AccountTeamList } from "../features/account-slice/account-lists";
import { yourPageHead } from "../features/account-slice/presentation";
import accountCSS from "../features/account-slice/account.css?url";

export const Route = createFileRoute("/account_/teams")({
  loader: async ({ context }) => {
    const dashboard = await getAccountDashboard();
    if (dashboard.status === "unauthenticated") {
      throw redirect({ to: "/login", search: { next: "/account/teams" } });
    }
    if (dashboard.status !== "found") {
      throw new Error("Your teams are unavailable");
    }
    return {
      teams: dashboard.teams,
      unavailable: dashboard.unavailable.teams,
      publicOrigin: context.publicOrigin,
    };
  },
  staleTime: 0,
  headers: () => ({ "cache-control": "private, no-store", vary: "Cookie" }),
  head: ({ loaderData }) => ({
    ...yourPageHead(loaderData?.publicOrigin, "teams"),
    links: [{ rel: "stylesheet", href: accountCSS }],
  }),
  pendingComponent: () => <RoutePending message="Loading your teams…" />,
  errorComponent: YourTeamsError,
  component: YourTeamsPage,
});

function YourTeamsPage() {
  const { teams, unavailable } = Route.useLoaderData();

  return (
    <main className="account-page your-page">
      <PageHeading
        actions={
          <ButtonLink to="/teams/new" variant="secondary">
            Create team
          </ButtonLink>
        }
        supporting="Teams you own, captain, or play on."
        title="Your teams"
      />
      {unavailable ? (
        <p role="alert">
          Your teams are unavailable right now. Please try again in a moment.
        </p>
      ) : (
        <AccountTeamList teams={teams} />
      )}
    </main>
  );
}

function YourTeamsError({ reset }: ErrorComponentProps) {
  return (
    <RouteErrorView
      reset={reset}
      eyebrow="Your teams unavailable"
      heading="We could not load your teams."
    />
  );
}
