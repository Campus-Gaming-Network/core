import type { TournamentDTO } from "../tournament-registration/contracts.js";
import type { MatchEntrantDTO, TournamentMatchDTO } from "./contracts.js";

export type TournamentSection =
  | "overview"
  | "entrants"
  | "bracket"
  | "schedule"
  | "rules"
  | "prizes";

/**
 * The tabs a tournament event shows, in order. Overview and the entrants
 * always show; Bracket once one is generated; Schedule once a match has a
 * time; Rules and Prizes when written.
 */
export function tournamentSections(
  tournament: Pick<
    TournamentDTO,
    "entry_type" | "entry_count" | "rules" | "prizes"
  >,
  hasBracket: boolean,
  hasSchedule = false,
): Array<{ section: TournamentSection; label: string }> {
  return [
    { section: "overview", label: "Overview" },
    {
      section: "entrants",
      label: `${tournament.entry_type === "team" ? "Teams" : "Players"} (${tournament.entry_count})`,
    },
    ...(hasBracket ? [{ section: "bracket", label: "Bracket" } as const] : []),
    ...(hasSchedule
      ? [{ section: "schedule", label: "Schedule" } as const]
      : []),
    ...(tournament.rules
      ? [{ section: "rules", label: "Rules" } as const]
      : []),
    ...(tournament.prizes
      ? [{ section: "prizes", label: "Prizes" } as const]
      : []),
  ];
}

export function bracketMayExist(tournament: Pick<TournamentDTO, "status">) {
  return (
    tournament.status === "in_progress" || tournament.status === "completed"
  );
}

export function roundName(round: number, rounds: number): string {
  if (round === rounds) return "Final";
  if (round === rounds - 1) return "Semifinals";
  if (round === rounds - 2) return "Quarterfinals";
  return `Round ${round}`;
}

/** An entrant as a match shows it; a signed-out viewer sees a solo player by seed. */
export function entrantName(entrant: MatchEntrantDTO): string {
  return entrant.player?.name ?? entrant.team?.name ?? `Seed ${entrant.seed}`;
}

export function matchName(match: TournamentMatchDTO, rounds: number): string {
  const round = roundName(match.round, rounds);
  return match.round === rounds ? round : `${round}, match ${match.position}`;
}

export function matchSummary(
  match: TournamentMatchDTO,
  rounds: number,
): string {
  const sides = match.entrants.map((entrant, slot) => {
    if (!entrant) return "to be decided";
    const score = match.scores ? ` ${match.scores[slot]}` : "";
    return `${entrantName(entrant)} (seed ${entrant.seed})${score}`;
  });
  const winner = match.entrants.find(
    (entrant) => entrant && entrant.entry_id === match.winner_entry_id,
  );
  const outcome = winner
    ? match.walkover
      ? `${entrantName(winner)} advanced on a walkover.`
      : `${entrantName(winner)} won.`
    : match.status === "live"
      ? "Live."
      : "Upcoming.";
  return `${matchName(match, rounds)}: ${sides.join(" vs ")}. ${outcome}`;
}

export type BracketBye = { entrant: MatchEntrantDTO; position: number };

export type BracketRound = {
  round: number;
  name: string;
  /**
   * Matches, and in the first round its byes, in position order. `row` is
   * the first of the `span` first-round rows the item is centred on.
   */
  items: Array<
    | { kind: "match"; match: TournamentMatchDTO; row: number; span: number }
    | { kind: "bye"; bye: BracketBye; row: number; span: 1 }
  >;
};

/**
 * The bracket by round. A bracket of R rounds has 2^(R-1) first-round
 * positions; a match in round r at position p sits over first-round rows
 * (p-1)·2^(r-1)+1 to p·2^(r-1), so it lines up between the two matches that
 * feed it. A first-round position with no match is a bye, whose entrant
 * waits in the second-round slot that position feeds.
 */
export function bracketRounds(matches: TournamentMatchDTO[]): BracketRound[] {
  const rounds = Math.max(0, ...matches.map((match) => match.round));
  const byRound = new Map<number, TournamentMatchDTO[]>();
  for (const match of matches) {
    byRound.set(match.round, [...(byRound.get(match.round) ?? []), match]);
  }
  return Array.from({ length: rounds }, (_, index) => {
    const round = index + 1;
    const span = 2 ** index;
    const items: BracketRound["items"] = (byRound.get(round) ?? []).map(
      (match) => ({
        kind: "match",
        match,
        row: (match.position - 1) * span + 1,
        span,
      }),
    );
    if (round === 1 && rounds > 1) {
      const played = new Set(items.map((item) => item.row));
      const second = byRound.get(2) ?? [];
      for (let position = 1; position <= 2 ** (rounds - 1); position++) {
        if (played.has(position)) continue;
        const entrant = second.find(
          (match) => match.position === Math.ceil(position / 2),
        )?.entrants[(position - 1) % 2];
        if (entrant) {
          items.push({
            kind: "bye",
            bye: { entrant, position },
            row: position,
            span: 1,
          });
        }
      }
      items.sort((a, b) => a.row - b.row);
    }
    return { round, name: roundName(round, rounds), items };
  });
}

/**
 * The scheduled matches in time order, grouped by day in the event's time
 * zone: "Sat, Jun 1, 2031". Matches without a time are left out.
 */
export function scheduleDays(
  matches: TournamentMatchDTO[],
  timeZone: string,
): Array<{ day: string; matches: TournamentMatchDTO[] }> {
  const day = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone,
  });
  const days: Array<{ day: string; matches: TournamentMatchDTO[] }> = [];
  const timed = matches
    .filter((match) => match.scheduled_at)
    .map((match) => ({ match, at: Date.parse(match.scheduled_at ?? "") }))
    .sort((a, b) => a.at - b.at || a.match.round - b.match.round);
  for (const { match, at } of timed) {
    const label = day.format(at);
    const last = days.at(-1);
    if (last?.day === label) last.matches.push(match);
    else days.push({ day: label, matches: [match] });
  }
  return days;
}

/** A match's time of day in the event's zone: "7:30 PM PDT". */
export function matchTime(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    timeZone,
  }).format(new Date(value));
}
