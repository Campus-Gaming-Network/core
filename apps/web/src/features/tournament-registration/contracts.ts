import * as z from "zod";
import {
  pageNoticeKey,
  type PageNotice,
} from "../../components/page-notice.js";

const slugSchema = z.string().trim().min(1).max(200);
const timestampSchema = z.iso.datetime({ offset: true });
const nonNegativeIntegerSchema = z.number().int().nonnegative();
const teamSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  slug: slugSchema,
});
const playerSchema = z.object({
  public_id: z.string().min(1),
  name: z.string(),
});

export const registrationModeSchema = z.enum(["open", "approval"]);
const entryStatusSchema = z.enum(["registered", "pending"]);

export const tournamentStatusSchema = z.enum([
  "draft",
  "registration_open",
  "in_progress",
  "completed",
  "cancelled",
]);

/** The tournament on a tournament-type event, as its page receives it. */
export const tournamentDtoSchema = z.object({
  game: z.object({ id: z.string().min(1), name: z.string(), slug: slugSchema }),
  entry_type: z.enum(["solo", "team"]),
  team_size: z.number().int().positive().optional(),
  substitutes: nonNegativeIntegerSchema,
  entrant_cap: z.number().int().positive().optional(),
  registration_closes_at: timestampSchema.optional(),
  format: z.string(),
  rules: z.string(),
  prizes: z.string(),
  /** A bracket hosted on another site. */
  bracket_url: z.string().optional(),
  registration_mode: registrationModeSchema,
  status: tournamentStatusSchema,
  entry_count: nonNegativeIntegerSchema,
  /** Pending requests in an approval tournament; organizers only. */
  request_count: nonNegativeIntegerSchema.optional(),
  /** The signed-in viewer's own entry, alone or with a team. */
  viewer_entry: z
    .object({
      id: z.uuid(),
      /** Pending while an organizer has yet to approve the request. */
      status: entryStatusSchema,
      team: teamSummarySchema.optional(),
      /** The solo player, or the team's owner or a captain. */
      can_manage: z.boolean(),
    })
    .optional(),
});
export type TournamentDTO = z.output<typeof tournamentDtoSchema>;

/**
 * A registered entry, or a pending request (with no seed) as organizers see
 * it. A signed-out viewer receives a solo entry with no player and a team
 * entry with no roster.
 */
export const tournamentEntryDtoSchema = z.object({
  id: z.uuid(),
  status: entryStatusSchema,
  seed: z.number().int().positive().optional(),
  player: playerSchema.optional(),
  team: teamSummarySchema.optional(),
  roster: z.array(playerSchema).optional(),
  registered_at: timestampSchema,
});
export const tournamentEntriesResponseDtoSchema = z.object({
  entries: z.array(tournamentEntryDtoSchema),
  /** Pending requests in request order; organizers only. */
  requests: z.array(tournamentEntryDtoSchema).optional(),
});
export type TournamentEntryDTO = z.output<typeof tournamentEntryDtoSchema>;

/** A team the viewer owns or captains, with the members a roster may pick. */
export const registrationTeamDtoSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  slug: slugSchema,
  entered: z.boolean(),
  members: z.array(playerSchema),
});
export const registrationTeamsResponseDtoSchema = z.object({
  teams: z.array(registrationTeamDtoSchema),
});
export type RegistrationTeamDTO = z.output<typeof registrationTeamDtoSchema>;

/** A list the page shows; unavailable never fails the page. */
export type TournamentListResult<T> =
  | { status: "ready"; items: T[] }
  | { status: "unavailable" };

/** The entrant list, with the pending requests for organizers. */
export type TournamentEntriesResult =
  | {
      status: "ready";
      items: TournamentEntryDTO[];
      requests: TournamentEntryDTO[];
    }
  | { status: "unavailable" };

/** Where a registration change returns, with a notice naming the outcome. */
export type TournamentMutationResult = {
  status: "success";
  redirectTo: string;
};

/** The notices the event page's registration panel can receive. */
export const tournamentNotices = {
  registered: { message: "You're registered.", severity: "success" },
  requested: {
    message:
      "Request sent. The organizers will approve or decline it, and you'll get a notice either way.",
    severity: "success",
  },
  withdrawn: {
    message: "Your entry or request was withdrawn.",
    severity: "success",
  },
  removed: { message: "Entry removed.", severity: "success" },
  approved: { message: "Request approved.", severity: "success" },
  declined: { message: "Request declined.", severity: "success" },
  "not-pending": {
    message: "That request was already approved, declined, or withdrawn.",
    severity: "danger",
  },
  closed: {
    message: "Registration for this tournament is closed.",
    severity: "danger",
  },
  full: { message: "This tournament is full.", severity: "danger" },
  "already-entered": {
    message: "You or this team are already entered in this tournament.",
    severity: "danger",
  },
  "entry-removed": {
    message:
      "An organizer removed this entry, so it cannot register for this tournament again.",
    severity: "danger",
  },
  "player-entered": {
    message:
      "Someone on that roster is already in another entry. Each player can be in one entry.",
    severity: "danger",
  },
  roster: {
    message:
      "Pick a roster of the team's members, from the team size up to the team size plus substitutes.",
    severity: "danger",
  },
  "team-not-allowed": {
    message: "Only the team's owner or a captain can register it.",
    severity: "danger",
  },
  "verify-email": {
    message: "Verify your email address before registering.",
    severity: "danger",
  },
  started: {
    message: "Entries are fixed once the tournament starts.",
    severity: "danger",
  },
  failed: {
    message: "We could not update your registration. Please try again.",
    severity: "danger",
  },
} as const satisfies Record<string, PageNotice>;
export type TournamentNotice = keyof typeof tournamentNotices;

/** The notice for an API error code from a registration change. */
export const tournamentErrorNotices: Record<string, TournamentNotice> = {
  tournament_registration_closed: "closed",
  tournament_not_found: "closed",
  tournament_full: "full",
  tournament_already_entered: "already-entered",
  tournament_entry_removed: "entry-removed",
  tournament_player_already_entered: "player-entered",
  invalid_tournament_roster: "roster",
  tournament_team_not_allowed: "team-not-allowed",
  email_verification_required: "verify-email",
  tournament_started: "started",
  tournament_entry_not_pending: "not-pending",
};

/** The event page's `tournament` search value, if it names a notice. */
export function tournamentNoticeKey(
  value: unknown,
): TournamentNotice | undefined {
  return pageNoticeKey(tournamentNotices, value);
}

const registerInputSchema = z.object({
  slug: slugSchema,
  team_slug: slugSchema.optional(),
  roster: z.array(z.string().trim().min(1).max(64)).max(40),
});
const entryInputSchema = z.object({ slug: slugSchema, entry_id: z.uuid() });

export type RegisterInput = z.output<typeof registerInputSchema>;
export type TournamentEntryInput = z.output<typeof entryInputSchema>;

/**
 * A form's fields, parsed. An invalid form still carries its slug, so the
 * redirect can return to the same event with a notice.
 */
export type ValidatedTournamentInput<T> =
  | { valid: true; value: T }
  | { valid: false; slug?: string };

/** A registration: the slug, and for a team its slug and roster picks. */
export function validateRegisterInput(
  input: object | FormData,
): ValidatedTournamentInput<RegisterInput> {
  const teamSlug = inputValue(input, "team_slug");
  return validated(registerInputSchema, {
    slug: inputValue(input, "slug"),
    ...(teamSlug ? { team_slug: teamSlug } : {}),
    roster: inputValues(input, "roster"),
  });
}

/** A withdrawal or removal of one entry. */
export function validateEntryInput(
  input: object | FormData,
): ValidatedTournamentInput<TournamentEntryInput> {
  return validated(entryInputSchema, {
    slug: inputValue(input, "slug"),
    entry_id: inputValue(input, "entry_id"),
  });
}

function validated<T>(
  schema: z.ZodType<T>,
  values: Record<string, unknown>,
): ValidatedTournamentInput<T> {
  const parsed = schema.safeParse(values);
  if (parsed.success) return { valid: true, value: parsed.data };
  const slug = slugSchema.safeParse(values.slug);
  return { valid: false, ...(slug.success ? { slug: slug.data } : {}) };
}

function inputValue(input: object | FormData, field: string): string {
  const value =
    input instanceof FormData
      ? input.get(field)
      : (input as Record<string, unknown>)[field];
  return typeof value === "string" ? value.trim() : "";
}

function inputValues(input: object | FormData, field: string): unknown[] {
  const values =
    input instanceof FormData
      ? input.getAll(field)
      : (input as Record<string, unknown>)[field];
  return Array.isArray(values) ? values : [];
}
