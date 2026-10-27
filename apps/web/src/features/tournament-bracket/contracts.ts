import * as z from "zod";
import {
  pageNoticeKey,
  type PageNotice,
} from "../../components/page-notice.js";
import type { ValidatedTournamentInput } from "../tournament-registration/contracts.js";

const slugSchema = z.string().trim().min(1).max(200);
const playerSchema = z.object({
  public_id: z.string().min(1),
  name: z.string(),
});

/** The most a side can score, as the API allows. */
export const maximumMatchScore = 1_000_000;

/**
 * An entry in a match slot. A signed-out viewer receives a solo entrant
 * without `player`, and sees it by seed.
 */
const matchEntrantSchema = z.object({
  entry_id: z.uuid(),
  seed: z.number().int().positive(),
  player: playerSchema.optional(),
  team: z
    .object({ id: z.string(), name: z.string(), slug: slugSchema })
    .optional(),
});

/** One match of a bracket. A slot is null until an earlier match decides it. */
export const tournamentMatchDtoSchema = z.object({
  id: z.uuid(),
  round: z.number().int().positive(),
  position: z.number().int().positive(),
  entrants: z.tuple([
    matchEntrantSchema.nullable(),
    matchEntrantSchema.nullable(),
  ]),
  status: z.enum(["upcoming", "live", "complete"]),
  scheduled_at: z.iso.datetime({ offset: true }).optional(),
  scores: z
    .tuple([z.number().int().nonnegative(), z.number().int().nonnegative()])
    .optional(),
  winner_entry_id: z.uuid().optional(),
  walkover: z.boolean().optional(),
  /** Where the winner goes; the final has none. */
  next_match_id: z.uuid().optional(),
});
export const tournamentMatchesResponseDtoSchema = z.object({
  matches: z.array(tournamentMatchDtoSchema),
});
export type TournamentMatchDTO = z.output<typeof tournamentMatchDtoSchema>;
export type MatchEntrantDTO = z.output<typeof matchEntrantSchema>;

/** The bracket a page shows; unavailable never fails the page. */
export type BracketResult =
  | { status: "ready"; matches: TournamentMatchDTO[] }
  | { status: "unavailable" };

/** The notices the bracket and match pages can receive. */
export const bracketNotices = {
  generated: { message: "Bracket generated.", severity: "success" },
  saved: {
    message: "Result saved. The winner has moved on.",
    severity: "success",
  },
  invalid: {
    message:
      "Enter both scores as whole numbers, with the winner on the higher score. An elimination match has no draw.",
    severity: "danger",
  },
  "not-ready": {
    message:
      "Both players or teams must be decided before the match has a result.",
    severity: "danger",
  },
  "result-locked": {
    message:
      "The winner's next match already has a result, so this result can't change.",
    severity: "danger",
  },
  locked: {
    message:
      "This tournament is over, so only the final's result can still be corrected.",
    severity: "danger",
  },
  "bracket-locked": {
    message:
      "A match has a result, so the bracket can no longer be generated again.",
    severity: "danger",
  },
  "not-started": {
    message: "Start the tournament before generating its bracket.",
    severity: "danger",
  },
  "needs-entrants": {
    message: "A bracket needs at least two entrants.",
    severity: "danger",
  },
  ended: {
    message: "The event has ended, so the bracket can no longer be generated.",
    severity: "danger",
  },
  forbidden: {
    message: "Only the event's organizers can run its bracket.",
    severity: "danger",
  },
  failed: {
    message: "We could not update the bracket. Please try again.",
    severity: "danger",
  },
} as const satisfies Record<string, PageNotice>;
export type BracketNotice = keyof typeof bracketNotices;

/** The notice for an API error code from a bracket or result change. */
export const bracketErrorNotices: Record<string, BracketNotice> = {
  invalid_request: "invalid",
  invalid_match_result: "invalid",
  tournament_match_not_ready: "not-ready",
  tournament_result_locked: "result-locked",
  tournament_locked: "locked",
  tournament_bracket_locked: "bracket-locked",
  tournament_not_started: "not-started",
  tournament_needs_entrants: "needs-entrants",
  event_ended: "ended",
  not_event_organizer: "forbidden",
};

/** The `bracket` search value of a tournament page, if it names a notice. */
export function bracketNoticeKey(value: unknown): BracketNotice | undefined {
  return pageNoticeKey(bracketNotices, value);
}

// A blank field is not a zero.
const scoreSchema = z
  .string()
  .regex(/^\d{1,7}$/)
  .transform(Number)
  .pipe(z.number().int().max(maximumMatchScore));

const resultInputSchema = z.discriminatedUnion("walkover", [
  z.object({
    slug: slugSchema,
    match_id: z.uuid(),
    winner_entry_id: z.uuid(),
    walkover: z.literal(false),
    scores: z.tuple([scoreSchema, scoreSchema]),
  }),
  z.object({
    slug: slugSchema,
    match_id: z.uuid(),
    winner_entry_id: z.uuid(),
    walkover: z.literal(true),
  }),
]);
const bracketInputSchema = z.object({ slug: slugSchema });

export type ResultInput = z.output<typeof resultInputSchema>;
export type BracketInput = z.output<typeof bracketInputSchema>;

/**
 * A result form: the winner and both scores, or a walkover, which names the
 * entrant who advances and has no scores. An invalid form keeps its slug and
 * match, so the redirect returns to the same match with a notice.
 */
export function validateResultInput(
  input: object | FormData,
): ValidatedTournamentInput<ResultInput> & { matchID?: string } {
  const walkover = inputValue(input, "walkover") === "true";
  const values = {
    slug: inputValue(input, "slug"),
    match_id: inputValue(input, "match_id"),
    winner_entry_id: inputValue(input, "winner_entry_id"),
    walkover,
    ...(walkover
      ? {}
      : { scores: [inputValue(input, "score1"), inputValue(input, "score2")] }),
  };
  const parsed = resultInputSchema.safeParse(values);
  if (parsed.success) return { valid: true, value: parsed.data };
  const slug = slugSchema.safeParse(values.slug);
  const matchID = z.uuid().safeParse(values.match_id);
  return {
    valid: false,
    ...(slug.success ? { slug: slug.data } : {}),
    ...(matchID.success ? { matchID: matchID.data } : {}),
  };
}

/** Generating the bracket names only the event. */
export function validateBracketInput(
  input: object | FormData,
): ValidatedTournamentInput<BracketInput> {
  const parsed = bracketInputSchema.safeParse({
    slug: inputValue(input, "slug"),
  });
  return parsed.success
    ? { valid: true, value: parsed.data }
    : { valid: false };
}

function inputValue(input: object | FormData, field: string): string {
  const value =
    input instanceof FormData
      ? input.get(field)
      : (input as Record<string, unknown>)[field];
  return typeof value === "string" ? value.trim() : "";
}
