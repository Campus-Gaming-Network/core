import { Link, createFileRoute } from "@tanstack/react-router";
import { RouteErrorView, RoutePending } from "../components/route-boundaries";
import { Surface } from "../components/surface";
import {
  entrantName,
  matchName,
  matchTime,
  scheduleDays,
} from "../features/tournament-bracket/presentation";
import {
  loadTournamentPage,
  TournamentPage,
  tournamentPageHead,
} from "../features/tournament-bracket/tournament-page";

export const Route = createFileRoute("/events/$slug_/schedule")({
  loader: ({ context, params }) =>
    loadTournamentPage(params.slug, context.publicOrigin),
  staleTime: 0,
  headers: () => ({ "cache-control": "private, no-store", vary: "Cookie" }),
  head: ({ loaderData }) =>
    tournamentPageHead(loaderData, { title: "Schedule", path: "schedule" }),
  pendingComponent: () => <RoutePending message="Loading the schedule…" />,
  errorComponent: () => (
    <RouteErrorView
      eyebrow="Schedule unavailable"
      heading="We could not load this tournament's schedule."
      description="Please try again in a moment."
      showNavigation={false}
    />
  ),
  component: SchedulePage,
});

function SchedulePage() {
  const data = Route.useLoaderData();
  const { bracket, event } = data;
  const matches = bracket.status === "ready" ? bracket.matches : [];
  const rounds = Math.max(0, ...matches.map((match) => match.round));
  const days = scheduleDays(matches, event.timezone);
  return (
    <TournamentPage current="schedule" data={data} heading="Schedule">
      {bracket.status === "unavailable" ? (
        <Surface variant="empty">
          <h2>The schedule is unavailable right now.</h2>
          <p>Please try again in a moment.</p>
        </Surface>
      ) : days.length === 0 ? (
        <Surface variant="empty">
          <h2>No matches are scheduled yet.</h2>
          <p>Scheduled matches will show here with their times.</p>
        </Surface>
      ) : (
        days.map(({ day, matches: dayMatches }) => (
          <section aria-label={day} className="match-schedule" key={day}>
            <h2>{day}</h2>
            <ol className="match-schedule__list">
              {dayMatches.map((match) => (
                <li key={match.id}>
                  <time dateTime={match.scheduled_at}>
                    {matchTime(match.scheduled_at ?? "", event.timezone)}
                  </time>
                  <Link
                    params={{ slug: event.slug, matchId: match.id }}
                    to="/events/$slug/matches/$matchId"
                  >
                    {matchName(match, rounds)}
                  </Link>
                  <span>
                    {match.entrants
                      .map((entrant) =>
                        entrant ? entrantName(entrant) : "To be decided",
                      )
                      .join(" vs ")}
                  </span>
                </li>
              ))}
            </ol>
          </section>
        ))
      )}
    </TournamentPage>
  );
}
