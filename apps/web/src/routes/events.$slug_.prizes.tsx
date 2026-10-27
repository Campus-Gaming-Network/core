import { createFileRoute } from "@tanstack/react-router";
import { RouteErrorView, RoutePending } from "../components/route-boundaries";
import {
  loadTournamentPage,
  TournamentPage,
  tournamentPageHead,
} from "../features/tournament-bracket/tournament-page";

export const Route = createFileRoute("/events/$slug_/prizes")({
  loader: ({ context, params }) =>
    loadTournamentPage(params.slug, context.publicOrigin),
  staleTime: 0,
  headers: () => ({ "cache-control": "private, no-store", vary: "Cookie" }),
  head: ({ loaderData }) =>
    tournamentPageHead(loaderData, { title: "Prizes", path: "prizes" }),
  pendingComponent: () => <RoutePending message="Loading the prizes…" />,
  errorComponent: () => (
    <RouteErrorView
      eyebrow="Prizes unavailable"
      heading="We could not load this tournament's prizes."
      description="Please try again in a moment."
      showNavigation={false}
    />
  ),
  component: PrizesPage,
});

function PrizesPage() {
  const data = Route.useLoaderData();
  return (
    <TournamentPage current="prizes" data={data} heading="Prizes">
      <section
        aria-labelledby="tournament-prizes-title"
        className="tournament-text"
      >
        <h2 id="tournament-prizes-title">Prizes</h2>
        <p>
          {data.event.tournament.prizes ||
            "The organizers have not listed prizes."}
        </p>
      </section>
    </TournamentPage>
  );
}
