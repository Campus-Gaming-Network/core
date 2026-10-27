import { zoneName } from "../event-slice/presentation.js";
import type { TournamentDTO, TournamentEntryDTO } from "./contracts.js";

/** What the registration panel shows the viewer. */
export type RegistrationState =
  | "registered"
  | "requested"
  | "not-open"
  | "closed"
  | "full"
  | "signed-out"
  | "open";

/**
 * The panel's state at `now`, the moment the page was rendered. Registration
 * closes at its close time or the event's start, whichever is first, and
 * when the tournament leaves registration open.
 */
export function registrationState(
  tournament: TournamentDTO,
  {
    authenticated,
    now,
    startsAt,
  }: { authenticated: boolean; now: Date; startsAt: string },
): RegistrationState {
  if (tournament.viewer_entry) {
    return tournament.viewer_entry.status === "pending"
      ? "requested"
      : "registered";
  }
  if (tournament.status === "draft") return "not-open";
  if (
    tournament.status !== "registration_open" ||
    now.getTime() >= registrationClosesAt(tournament, startsAt).getTime()
  ) {
    return "closed";
  }
  if (
    tournament.entrant_cap !== undefined &&
    tournament.entry_count >= tournament.entrant_cap
  ) {
    return "full";
  }
  return authenticated ? "open" : "signed-out";
}

function registrationClosesAt(
  tournament: TournamentDTO,
  startsAt: string,
): Date {
  const start = new Date(startsAt);
  if (!tournament.registration_closes_at) return start;
  const closes = new Date(tournament.registration_closes_at);
  return closes < start ? closes : start;
}

/** "Solo", "Teams", or "Teams of 5, up to 1 substitute". */
function tournamentEntryLabel(tournament: TournamentDTO): string {
  if (tournament.entry_type === "solo") return "Solo";
  const teams =
    tournament.team_size === undefined
      ? "Teams"
      : `Teams of ${tournament.team_size}`;
  return tournament.substitutes > 0
    ? `${teams}, up to ${tournament.substitutes} ${tournament.substitutes === 1 ? "substitute" : "substitutes"}`
    : teams;
}

/** The bracket formats by name, in the order they ship. */
const tournamentFormatLabels: Record<string, string> = {
  single_elimination: "Single elimination",
  round_robin: "Round robin",
  swiss: "Swiss",
  double_elimination: "Double elimination",
};

/**
 * How a tournament is played, for the event page's facts: "Single elimination
 * · Teams of 5 · Valorant". The entrant count and cost have their own places
 * on the page, so they are left out, as is a format or game the tournament
 * does not state.
 */
export function tournamentFormatSummary(tournament: TournamentDTO): string {
  return [
    tournamentFormatLabels[tournament.format],
    tournamentEntryLabel(tournament),
    tournament.game.name,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** "Solo · 3 of 16 registered" or "Teams of 5, up to 1 substitute · …". */
export function tournamentSummary(tournament: TournamentDTO): string {
  const entry = tournamentEntryLabel(tournament);
  const count =
    tournament.entrant_cap === undefined
      ? `${tournament.entry_count} registered`
      : `${tournament.entry_count} of ${tournament.entrant_cap} registered`;
  return `${entry} · ${count}`;
}

/** When registration closes, in the event's time zone. */
export function registrationClosesLabel(
  tournament: TournamentDTO,
  { startsAt, timeZone }: { startsAt: string; timeZone: string },
): string {
  if (!tournament.registration_closes_at) {
    return "Registration closes when the event starts.";
  }
  const closes = registrationClosesAt(tournament, startsAt);
  const local = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(closes);
  return `Registration closes ${`${local} ${zoneName(closes, timeZone)}`.trim()}.`;
}

/** Bracket sites named the way they name themselves. */
const bracketHosts: Record<string, string> = {
  "start.gg": "start.gg",
  "challonge.com": "Challonge",
  "battlefy.com": "Battlefy",
};

/**
 * The site an external bracket is on, for "Bracket on start.gg": a known
 * bracket site by its name, anything else by its host without `www.`.
 */
export function bracketHost(url: string): string {
  const host = new URL(url).hostname.replace(/^www\./, "");
  const known = Object.keys(bracketHosts).find(
    (site) => host === site || host.endsWith(`.${site}`),
  );
  return known ? bracketHosts[known] : host;
}

/** The heading of the entrant list. */
export function entrantsHeading(tournament: TournamentDTO): string {
  return `${tournament.entry_type === "solo" ? "Players" : "Teams"} (${tournament.entry_count})`;
}

/**
 * An entry's name: the player or team, or its seed for a solo entrant a
 * signed-out viewer cannot see.
 */
export function entrantName(entry: TournamentEntryDTO): string {
  return entry.player?.name ?? entry.team?.name ?? `Seed ${entry.seed}`;
}
