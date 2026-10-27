import { createFileRoute } from "@tanstack/react-router";
import { RouteErrorView, RoutePending } from "../components/route-boundaries";
import { Surface } from "../components/surface";
import { BracketView } from "../features/tournament-bracket/bracket-views";
import {
  bracketNoticeKey,
  type BracketNotice,
} from "../features/tournament-bracket/contracts";
import {
  loadTournamentPage,
  TournamentPage,
  tournamentPageHead,
} from "../features/tournament-bracket/tournament-page";

export const Route = createFileRoute("/events/$slug_/bracket")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { bracket?: BracketNotice } => {
    const bracket = bracketNoticeKey(search.bracket);
    return bracket ? { bracket } : {};
  },
  loader: ({ context, params }) =>
    loadTournamentPage(params.slug, context.publicOrigin),
  staleTime: 0,
  headers: () => ({ "cache-control": "private, no-store", vary: "Cookie" }),
  head: ({ loaderData }) =>
    tournamentPageHead(loaderData, { title: "Bracket", path: "bracket" }),
  pendingComponent: () => <RoutePending message="Loading the bracket…" />,
  errorComponent: () => (
    <RouteErrorView
      eyebrow="Bracket unavailable"
      heading="We could not load this bracket."
      description="Please try again in a moment."
      showNavigation={false}
    />
  ),
  component: BracketPage,
});

function BracketPage() {
  const data = Route.useLoaderData();
  const search = Route.useSearch();
  const { bracket, event } = data;
  return (
    <TournamentPage
      current="bracket"
      data={data}
      heading="Bracket"
      notice={search.bracket}
    >
      {bracket.status === "unavailable" ? (
        <Surface variant="empty">
          <h2>The bracket is unavailable right now.</h2>
          <p>Please try again in a moment.</p>
        </Surface>
      ) : bracket.matches.length === 0 ? (
        <Surface variant="empty">
          <h2>No bracket yet.</h2>
          <p>
            {event.viewer_can_edit
              ? "Start the tournament, then generate the bracket from its settings."
              : "The organizers will publish the bracket once the tournament starts."}
          </p>
        </Surface>
      ) : (
        <BracketView matches={bracket.matches} slug={event.slug} />
      )}
    </TournamentPage>
  );
}
