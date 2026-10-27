import { createFileRoute } from "@tanstack/react-router";
import { PageNoticeView } from "../components/page-notice-view";
import { RouteErrorView, RoutePending } from "../components/route-boundaries";
import {
  loadTournamentPage,
  TournamentPage,
  tournamentPageHead,
  type TournamentPageData,
} from "../features/tournament-bracket/tournament-page";
import {
  tournamentNoticeKey,
  tournamentNotices,
  type TournamentEntriesResult,
  type TournamentNotice,
} from "../features/tournament-registration/contracts";
import { EntrantsCard } from "../features/tournament-registration/registration-panel";
import { getTournamentEntries } from "../features/tournament-registration/tournament.functions";

export const Route = createFileRoute("/events/$slug_/entrants")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { tournament?: TournamentNotice } => {
    const tournament = tournamentNoticeKey(search.tournament);
    return tournament ? { tournament } : {};
  },
  loader: async ({
    context,
    params,
  }): Promise<TournamentPageData & { entries: TournamentEntriesResult }> => {
    const entries = await getTournamentEntries({ data: { slug: params.slug } });
    return {
      ...(await loadTournamentPage(params.slug, context.publicOrigin)),
      entries,
    };
  },
  staleTime: 0,
  headers: () => ({ "cache-control": "private, no-store", vary: "Cookie" }),
  head: ({ loaderData }) =>
    tournamentPageHead(loaderData, {
      title:
        loaderData?.event.tournament.entry_type === "team"
          ? "Teams"
          : "Players",
      path: "entrants",
    }),
  pendingComponent: () => <RoutePending message="Loading the entrants…" />,
  errorComponent: () => (
    <RouteErrorView
      eyebrow="Entrants unavailable"
      heading="We could not load this tournament's entrants."
      description="Please try again in a moment."
      showNavigation={false}
    />
  ),
  component: EntrantsPage,
});

function EntrantsPage() {
  const data = Route.useLoaderData();
  const search = Route.useSearch();
  const { event } = data;
  return (
    <TournamentPage
      current="entrants"
      data={data}
      heading={event.tournament.entry_type === "team" ? "Teams" : "Players"}
    >
      <PageNoticeView
        notice={
          search.tournament ? tournamentNotices[search.tournament] : undefined
        }
      />
      <EntrantsCard
        canRemove={
          Boolean(event.viewer_can_edit) &&
          event.tournament.status === "registration_open"
        }
        entries={data.entries}
        slug={event.slug}
        tournament={event.tournament}
      />
    </TournamentPage>
  );
}
