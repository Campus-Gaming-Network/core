import { Link, createFileRoute, notFound } from "@tanstack/react-router";
import { RouteErrorView, RoutePending } from "../components/route-boundaries";
import { Surface } from "../components/surface";
import {
  ResultForms,
  ScheduleForm,
} from "../features/tournament-bracket/bracket-views";
import {
  bracketNoticeKey,
  type BracketNotice,
  type TournamentMatchDTO,
} from "../features/tournament-bracket/contracts";
import {
  entrantName,
  matchName,
} from "../features/tournament-bracket/presentation";
import {
  loadTournamentPage,
  TournamentPage,
  tournamentPageHead,
  type TournamentPageData,
} from "../features/tournament-bracket/tournament-page";

type MatchRouteData = TournamentPageData & {
  match: TournamentMatchDTO;
  next?: TournamentMatchDTO;
  rounds: number;
};

const statusLabels = {
  upcoming: "Upcoming",
  live: "Live",
  complete: "Complete",
} as const satisfies Record<TournamentMatchDTO["status"], string>;

export const Route = createFileRoute("/events/$slug_/matches/$matchId")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { bracket?: BracketNotice } => {
    const bracket = bracketNoticeKey(search.bracket);
    return bracket ? { bracket } : {};
  },
  loader: async ({ context, params }): Promise<MatchRouteData> => {
    const data = await loadTournamentPage(params.slug, context.publicOrigin);
    const matches = data.bracket.status === "ready" ? data.bracket.matches : [];
    const match = matches.find((candidate) => candidate.id === params.matchId);
    if (!match) {
      if (data.bracket.status === "unavailable") {
        throw new Error("The bracket is unavailable");
      }
      throw notFound();
    }
    const next = matches.find(
      (candidate) => candidate.id === match.next_match_id,
    );
    return {
      ...data,
      match,
      ...(next ? { next } : {}),
      rounds: Math.max(...matches.map((candidate) => candidate.round)),
    };
  },
  staleTime: 0,
  headers: () => ({ "cache-control": "private, no-store", vary: "Cookie" }),
  head: ({ loaderData }) =>
    tournamentPageHead(loaderData, {
      title: loaderData
        ? matchName(loaderData.match, loaderData.rounds)
        : "Match",
      path: loaderData ? `matches/${loaderData.match.id}` : "bracket",
    }),
  pendingComponent: () => <RoutePending message="Loading the match…" />,
  errorComponent: () => (
    <RouteErrorView
      eyebrow="Match unavailable"
      heading="We could not load this match."
      description="Please try again in a moment."
      showNavigation={false}
    />
  ),
  component: MatchPage,
});

function MatchPage() {
  const data = Route.useLoaderData();
  const search = Route.useSearch();
  const { event, match, next, rounds } = data;
  const name = matchName(match, rounds);
  const [first, second] = match.entrants;
  const tournamentOpen =
    event.tournament.status === "in_progress" ||
    (event.tournament.status === "completed" &&
      !next &&
      Boolean(match.winner_entry_id));
  const fixed = Boolean(match.winner_entry_id && next?.winner_entry_id);
  return (
    <TournamentPage
      current="bracket"
      data={data}
      heading={name}
      notice={search.bracket}
    >
      <Surface variant="card" aria-labelledby="match-title">
        <h2 id="match-title">{name}</h2>
        <div className="detail-card-body">
          <dl className="match-detail">
            {match.entrants.map((entrant, slot) => (
              <div
                className={
                  entrant && entrant.entry_id === match.winner_entry_id
                    ? "match-detail__side match-detail__side--winner"
                    : "match-detail__side"
                }
                // Each slot is fixed, so its index is a stable key.
                // oxlint-disable-next-line react/no-array-index-key
                key={slot}
              >
                <dt>
                  {entrant ? (
                    <>
                      <span className="match-detail__seed">{`Seed ${entrant.seed}`}</span>
                      {entrant.player ? (
                        <Link
                          params={{ id: entrant.player.public_id }}
                          to="/users/$id"
                        >
                          {entrant.player.name}
                        </Link>
                      ) : entrant.team ? (
                        <Link
                          params={{ slug: entrant.team.slug }}
                          to="/teams/$slug"
                        >
                          {entrant.team.name}
                        </Link>
                      ) : (
                        entrantName(entrant)
                      )}
                    </>
                  ) : (
                    "To be decided"
                  )}
                </dt>
                <dd>
                  {match.scores
                    ? match.scores[slot]
                    : match.walkover &&
                        entrant?.entry_id === match.winner_entry_id
                      ? "Walkover"
                      : "–"}
                </dd>
              </div>
            ))}
          </dl>
          <p>
            <strong>{statusLabels[match.status]}</strong>
            {match.scheduled_at
              ? ` · ${new Intl.DateTimeFormat("en-US", {
                  dateStyle: "medium",
                  timeStyle: "short",
                  timeZone: event.timezone,
                }).format(new Date(match.scheduled_at))}`
              : ""}
          </p>
          {next ? (
            <p>
              {"The winner plays in "}
              <Link
                params={{ slug: event.slug, matchId: next.id }}
                to="/events/$slug/matches/$matchId"
              >
                {matchName(next, rounds)}
              </Link>
              .
            </p>
          ) : (
            <p>The winner wins the tournament.</p>
          )}
          <Link
            className="link"
            params={{ slug: event.slug }}
            to="/events/$slug/bracket"
          >
            Back to the bracket
          </Link>
        </div>
      </Surface>
      {event.viewer_can_edit &&
      event.tournament.status === "in_progress" &&
      !match.winner_entry_id ? (
        <ScheduleForm
          match={match}
          slug={event.slug}
          timeZone={event.timezone}
        />
      ) : null}
      {event.viewer_can_edit && tournamentOpen ? (
        first && second ? (
          fixed ? (
            <p className="form-help">
              The winner's next match has a result, so this result can no longer
              change.
            </p>
          ) : (
            <ResultForms
              entrants={[first, second]}
              match={match}
              slug={event.slug}
            />
          )
        ) : (
          <p className="form-help">
            The result can be entered once both sides are decided.
          </p>
        )
      ) : null}
    </TournamentPage>
  );
}
