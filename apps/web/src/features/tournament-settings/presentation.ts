import type { TournamentDTO } from "../tournament-registration/contracts.js";

export const tournamentStatusLabels = {
  draft: "Draft",
  registration_open: "Registration open",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
} as const satisfies Record<TournamentDTO["status"], string>;

export type StatusAction =
  | {
      kind: "status";
      status: TournamentDTO["status"];
      label: string;
      primary: boolean;
    }
  | { kind: "delete" };

function move(
  status: TournamentDTO["status"],
  label: string,
  primary = false,
): StatusAction {
  return { kind: "status", status, label, primary };
}

/**
 * The moves the API allows from the tournament's status, in the order the
 * panel shows them. Going back to draft needs no entries or requests, starting
 * needs two entries,
 * and once the event has ended the only move left is completing it.
 */
export function statusActions(
  tournament: TournamentDTO,
  { ended }: { ended: boolean },
): StatusAction[] {
  const cancel = move("cancelled", "Cancel tournament");
  if (ended) {
    return tournament.status === "in_progress"
      ? [move("completed", "Mark complete", true)]
      : [];
  }
  switch (tournament.status) {
    case "draft":
      return [
        move("registration_open", "Open registration", true),
        { kind: "delete" },
        cancel,
      ];
    case "registration_open":
      return [
        ...(tournament.entry_count >= 2
          ? [move("in_progress", "Start tournament", true)]
          : []),
        ...(tournament.entry_count + (tournament.request_count ?? 0) === 0
          ? [move("draft", "Back to draft")]
          : []),
        cancel,
      ];
    case "in_progress":
      return [move("completed", "Mark complete", true), cancel];
    default:
      return [];
  }
}
