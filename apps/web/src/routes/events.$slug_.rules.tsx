import { createFileRoute } from "@tanstack/react-router";
import { RouteErrorView, RoutePending } from "../components/route-boundaries";
import {
  loadTournamentPage,
  TournamentPage,
  tournamentPageHead,
} from "../features/tournament-bracket/tournament-page";

export const Route = createFileRoute("/events/$slug_/rules")({
  loader: ({ context, params }) =>
    loadTournamentPage(params.slug, context.publicOrigin),
  staleTime: 0,
  headers: () => ({ "cache-control": "private, no-store", vary: "Cookie" }),
  head: ({ loaderData }) =>
    tournamentPageHead(loaderData, { title: "Rules", path: "rules" }),
  pendingComponent: () => <RoutePending message="Loading the rules…" />,
  errorComponent: () => (
    <RouteErrorView
      eyebrow="Rules unavailable"
      heading="We could not load this tournament's rules."
      description="Please try again in a moment."
      showNavigation={false}
    />
  ),
  component: RulesPage,
});

function RulesPage() {
  const data = Route.useLoaderData();
  return (
    <TournamentPage current="rules" data={data} heading="Rules">
      <section
        aria-labelledby="tournament-rules-title"
        className="tournament-text"
      >
        <h2 id="tournament-rules-title">Rules</h2>
        <p>
          {data.event.tournament.rules ||
            "The organizers have not written rules."}
        </p>
      </section>
    </TournamentPage>
  );
}
