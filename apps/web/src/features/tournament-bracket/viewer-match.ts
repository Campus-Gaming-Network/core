import type { MatchEntrantDTO, TournamentMatchDTO } from "./contracts.js";
import { matchName } from "./presentation.js";

/**
 * Where the viewer's own entry stands in the bracket:
 * - `next`: the earliest match it still has to play. `opponent` is absent
 *   while the other slot waits on an earlier match, named in `waitingOn`.
 * - `won`: it won the final.
 * - `out`: it lost `match`.
 */
export type ViewerMatch =
  | {
      kind: "next";
      match: TournamentMatchDTO;
      name: string;
      opponent?: MatchEntrantDTO;
      waitingOn?: string;
    }
  | { kind: "won" }
  | { kind: "out"; match: TournamentMatchDTO; name: string };

/**
 * The viewer's place in a single-elimination bracket, or undefined when the
 * entry has no match (not seeded into this bracket). A bye puts an entry
 * straight into the second round, so its first match is found the same way.
 */
export function viewerMatch(
  matches: TournamentMatchDTO[],
  entryID: string,
): ViewerMatch | undefined {
  const rounds = Math.max(0, ...matches.map((match) => match.round));
  const own = matches
    .filter((match) =>
      match.entrants.some((entrant) => entrant?.entry_id === entryID),
    )
    // Sorts the new array filter returns, and the web's lib has no toSorted.
    // oxlint-disable-next-line unicorn/no-array-sort
    .sort((a, b) => a.round - b.round);
  const lost = own.find(
    (match) =>
      match.status === "complete" &&
      match.winner_entry_id !== undefined &&
      match.winner_entry_id !== entryID,
  );
  if (lost) return { kind: "out", match: lost, name: matchName(lost, rounds) };
  const next = own.find((match) => match.status !== "complete");
  if (!next) {
    const final = own.at(-1);
    return final?.round === rounds && final.winner_entry_id === entryID
      ? { kind: "won" }
      : undefined;
  }
  const opponent =
    next.entrants.find(
      (entrant) => entrant !== null && entrant.entry_id !== entryID,
    ) ?? undefined;
  if (opponent) {
    return {
      kind: "next",
      match: next,
      name: matchName(next, rounds),
      opponent,
    };
  }
  const feeder = matches.find(
    (match) =>
      match.next_match_id === next.id &&
      !match.entrants.some((entrant) => entrant?.entry_id === entryID),
  );
  return {
    kind: "next",
    match: next,
    name: matchName(next, rounds),
    ...(feeder ? { waitingOn: matchName(feeder, rounds) } : {}),
  };
}
