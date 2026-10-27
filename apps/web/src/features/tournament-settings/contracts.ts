import * as z from "zod";
import {
  pageNoticeKey,
  type PageNotice,
} from "../../components/page-notice.js";
import { localDateTimeToInstant } from "../event-slice/event-time.js";
import { safeExternalEventUrl } from "../event-slice/presentation.js";
import {
  tournamentStatusSchema,
  type ValidatedTournamentInput,
} from "../tournament-registration/contracts.js";

const slugSchema = z.string().trim().min(1).max(200);

export const settingsNotices = {
  saved: { message: "Tournament settings saved.", severity: "success" },
  deleted: { message: "Tournament settings deleted.", severity: "success" },
  registration_open: {
    message: "Registration is open.",
    severity: "success",
  },
  draft: {
    message: "The tournament is back in draft. Only organizers can see it.",
    severity: "success",
  },
  in_progress: {
    message: "The tournament has started. Registration is closed.",
    severity: "success",
  },
  completed: { message: "The tournament is complete.", severity: "success" },
  cancelled: { message: "The tournament was cancelled.", severity: "success" },
  "has-rsvps": {
    message:
      "Someone other than the organizers has RSVP'd, so this event can't take tournament registrations.",
    severity: "danger",
  },
  "event-type": {
    message:
      "Tournament settings need an event whose type is Tournament. Change the type on the event first.",
    severity: "danger",
  },
  game: {
    message: "The tournament's game must be one of the event's games.",
    severity: "danger",
  },
  ended: {
    message:
      "The event has ended, so the only change left is to mark the tournament complete.",
    severity: "danger",
  },
  locked: {
    message:
      "A completed or cancelled tournament can't be changed, and only a draft's settings can be deleted.",
    severity: "danger",
  },
  status: {
    message: "The tournament can't move to that status from where it is now.",
    severity: "danger",
  },
  "has-entries": {
    message:
      "Someone has registered or asked to, so the entry type, team size, and format are fixed and the tournament can't go back to draft.",
    severity: "danger",
  },
  "has-requests": {
    message:
      "Approve or decline the pending requests before switching registration back to open.",
    severity: "danger",
  },
  "needs-entrants": {
    message: "Starting the tournament needs at least two entrants.",
    severity: "danger",
  },
  forbidden: {
    message: "Only the event's organizers can change its tournament.",
    severity: "danger",
  },
  invalid: {
    message:
      "Check the settings: team size is 2 to 20, substitutes up to the team size, the cap 2 to 512, registration must close by the event's start, and a bracket link must start with http:// or https://.",
    severity: "danger",
  },
  failed: {
    message: "We could not update the tournament. Please try again.",
    severity: "danger",
  },
} as const satisfies Record<string, PageNotice>;
export type SettingsNotice = keyof typeof settingsNotices;

export const settingsErrorNotices: Record<string, SettingsNotice> = {
  event_has_rsvps: "has-rsvps",
  tournament_event_type_required: "event-type",
  tournament_game_not_on_event: "game",
  event_ended: "ended",
  tournament_locked: "locked",
  invalid_tournament_status: "status",
  tournament_has_entries: "has-entries",
  tournament_needs_entrants: "needs-entrants",
  tournament_has_requests: "has-requests",
  not_event_organizer: "forbidden",
  invalid_request: "invalid",
};

export function settingsNoticeKey(value: unknown): SettingsNotice | undefined {
  return pageNoticeKey(settingsNotices, value);
}

export type TournamentSettingsPayload = {
  game_id: string;
  entry_type: "solo" | "team";
  team_size?: number;
  substitutes: number;
  entrant_cap?: number;
  registration_closes_at?: string;
  format: "single_elimination";
  rules: string;
  prizes: string;
  bracket_url: string;
  registration_mode: "open" | "approval";
};

export type SettingsInput = {
  slug: string;
  settings: TournamentSettingsPayload;
};

const wholeNumber = (min: number, max: number) =>
  z.coerce.number().int().min(min).max(max);

const settingsFormSchema = z
  .object({
    slug: slugSchema,
    game_id: z.string().trim().min(1).max(64),
    entry_type: z.enum(["solo", "team"]),
    registration_mode: z.enum(["open", "approval"]),
    team_size: z.string(),
    substitutes: z.string(),
    entrant_cap: z.string(),
    registration_closes_at: z.string(),
    timezone: z.string().trim().min(1).max(64),
    rules: z.string().max(10000),
    prizes: z.string().max(2000),
    bracket_url: z
      .string()
      .max(500)
      .refine(
        (value) => value === "" || safeExternalEventUrl(value) !== undefined,
      ),
  })
  .transform((form, context): SettingsInput => {
    const fail = () => {
      context.addIssue({ code: "custom", message: "invalid settings" });
      return z.NEVER;
    };
    let team: Pick<TournamentSettingsPayload, "team_size" | "substitutes"> = {
      substitutes: 0,
    };
    if (form.entry_type === "team") {
      const size = wholeNumber(2, 20).safeParse(form.team_size);
      if (!size.success) return fail();
      const substitutes = wholeNumber(0, size.data).safeParse(
        form.substitutes || "0",
      );
      if (!substitutes.success) return fail();
      team = { team_size: size.data, substitutes: substitutes.data };
    }
    let cap: number | undefined;
    if (form.entrant_cap) {
      const parsed = wholeNumber(2, 512).safeParse(form.entrant_cap);
      if (!parsed.success) return fail();
      cap = parsed.data;
    }
    let closes: string | undefined;
    if (form.registration_closes_at) {
      const instant = localDateTimeToInstant(
        form.registration_closes_at,
        form.timezone,
      );
      if (!instant.success) return fail();
      closes = instant.instant;
    }
    return {
      slug: form.slug,
      settings: {
        game_id: form.game_id,
        entry_type: form.entry_type,
        ...team,
        ...(cap === undefined ? {} : { entrant_cap: cap }),
        ...(closes === undefined ? {} : { registration_closes_at: closes }),
        format: "single_elimination",
        rules: form.rules.trim(),
        prizes: form.prizes.trim(),
        bracket_url: form.bracket_url,
        registration_mode: form.registration_mode,
      },
    };
  });

const statusInputSchema = z.object({
  slug: slugSchema,
  status: tournamentStatusSchema,
});
const slugInputSchema = z.object({ slug: slugSchema });

export type StatusInput = z.output<typeof statusInputSchema>;
export type SlugInput = z.output<typeof slugInputSchema>;

/**
 * The settings form, parsed: whole numbers in range, team fields only for a
 * team tournament, and the close time read in the event's time zone.
 */
export function validateSettingsInput(
  input: object | FormData,
): ValidatedTournamentInput<SettingsInput> {
  return validated(settingsFormSchema, {
    slug: inputValue(input, "slug"),
    game_id: inputValue(input, "game_id"),
    entry_type: inputValue(input, "entry_type"),
    registration_mode: inputValue(input, "registration_mode") || "open",
    team_size: inputValue(input, "team_size"),
    substitutes: inputValue(input, "substitutes"),
    entrant_cap: inputValue(input, "entrant_cap"),
    registration_closes_at: inputValue(input, "registration_closes_at"),
    timezone: inputValue(input, "timezone"),
    rules: inputValue(input, "rules"),
    prizes: inputValue(input, "prizes"),
    bracket_url: inputValue(input, "bracket_url").trim(),
  });
}

export function validateStatusInput(
  input: object | FormData,
): ValidatedTournamentInput<StatusInput> {
  return validated(statusInputSchema, {
    slug: inputValue(input, "slug"),
    status: inputValue(input, "status"),
  });
}

export function validateSlugInput(
  input: object | FormData,
): ValidatedTournamentInput<SlugInput> {
  return validated(slugInputSchema, { slug: inputValue(input, "slug") });
}

function validated<T>(
  schema: z.ZodType<T, unknown>,
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
  return typeof value === "string" ? value : "";
}
