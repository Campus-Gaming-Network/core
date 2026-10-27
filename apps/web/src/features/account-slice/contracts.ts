import * as z from "zod";
import type { WithSchoolLogo } from "../school-slice/contracts.js";
import { formString } from "../../components/form-string.js";

const identifierSchema = z.string().trim().min(1);
const timestampSchema = z.iso.datetime({ offset: true });
const nonNegativeIntegerSchema = z.number().int().nonnegative();

// How many events each dashboard list asks the API for. A list this long may
// have been cut off, so the page cannot treat its length as a total.
// The most events the dashboard reads per list (the API's maximum). Most
// lists preview a few; the interested list shows them all.
export const dashboardEventLimit = 25;

const schoolSummarySchema = z.object({
  id: identifierSchema,
  name: z.string(),
  slug: identifierSchema,
  city: z.string().optional(),
  state: z.string().optional(),
});

const gameSummarySchema = z.object({
  id: identifierSchema,
  name: z.string(),
  slug: identifierSchema,
});

// A link is a URL or a Discord username. A link without a kind is a URL link.
const socialLinkSchema = z.union([
  z.object({
    id: identifierSchema.optional(),
    kind: z.literal("url").default("url"),
    label: z.string(),
    url: z.string(),
  }),
  z.object({
    id: identifierSchema.optional(),
    kind: z.literal("discord"),
    label: z.string(),
    username: z.string(),
  }),
]);

export const accountProfileDtoSchema = z.object({
  id: identifierSchema,
  public_id: identifierSchema,
  email: z.email(),
  email_verified_at: timestampSchema.optional(),
  verification_level: identifierSchema,
  name: z.string(),
  bio: z.string().optional(),
  timezone: identifierSchema,
  home_school_id: identifierSchema,
  home_school: schoolSummarySchema.optional(),
  // Up to three URL links and one Discord username.
  social_links: z.array(socialLinkSchema).max(4).optional(),
  role_indicators: z.array(z.string()).optional(),
  /** Whether signed-in people see this person in member lists; on by default. */
  show_in_lists: z.boolean().default(true),
});

const dashboardEventDtoSchema = z.object({
  id: identifierSchema,
  title: z.string(),
  slug: identifierSchema,
  starts_at: timestampSchema,
  ends_at: timestampSchema,
  timezone: identifierSchema,
  lifecycle: z.enum(["upcoming", "happening_now", "ended", "full"]),
  host_school: schoolSummarySchema.pick({ name: true, slug: true }),
  host_team: z.object({ name: z.string(), slug: identifierSchema }).optional(),
  host_club: z.object({ name: z.string(), slug: identifierSchema }).optional(),
  games: z.array(gameSummarySchema.pick({ name: true })),
  rsvp_yes_count: nonNegativeIntegerSchema,
  interest_count: nonNegativeIntegerSchema,
  viewer_rsvp: z.enum(["yes", "maybe", "no"]).optional(),
});

export const dashboardEventsDtoSchema = z.object({
  upcoming_rsvps: z.array(dashboardEventDtoSchema),
  followed_school_events: z.array(dashboardEventDtoSchema),
  interested_events: z.array(dashboardEventDtoSchema).default([]),
});

export const createdEventsDtoSchema = z.object({
  events: z.array(dashboardEventDtoSchema),
  next_cursor: z.string().max(512),
});

export type CreatedEventsResult =
  | { status: "found"; events: DashboardEventDTO[]; nextCursor: string }
  | { status: "unauthenticated" }
  | { status: "unavailable" };

const createdCursorSchema = z.string().trim().min(1).max(512);

export function validateYourEventsSearch(search: Record<string, unknown>): {
  created?: string;
} {
  const created = createdCursorSchema.safeParse(search.created);
  return created.success ? { created: created.data } : {};
}

export const followedSchoolsDtoSchema = z.object({
  schools: z.array(schoolSummarySchema),
});

const accountTeamDtoSchema = z.object({
  id: identifierSchema,
  name: z.string(),
  slug: identifierSchema,
  member_count: nonNegativeIntegerSchema,
  school: schoolSummarySchema.pick({ name: true }).optional(),
  games: z.array(gameSummarySchema.pick({ name: true })),
  viewer_role: z.enum(["owner", "captain", "member"]).optional(),
});

export const myTeamsDtoSchema = z.object({
  teams: z.array(accountTeamDtoSchema),
  limit: nonNegativeIntegerSchema,
});

const timeZoneSchema = z
  .string()
  .trim()
  .min(1, "Time zone is required.")
  .refine(isIANATimeZone, "Enter a valid IANA time zone.");

const profileSocialLinkInputSchema = z.object({
  label: z
    .string()
    .trim()
    .min(1, "Social link label is required.")
    .max(40, "Social link label must be 40 characters or fewer."),
  url: z
    .string()
    .trim()
    .min(1, "Social link URL is required.")
    .max(500, "Social link URL must be 500 characters or fewer.")
    .refine(isHTTPURL, "Social link URL must use HTTP or HTTPS."),
});

const updateProfileInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required.")
    .max(120, "Name must be 120 characters or fewer."),
  bio: z.string().trim().max(2000, "Bio must be 2000 characters or fewer."),
  timezone: timeZoneSchema,
  social_links: z.array(profileSocialLinkInputSchema).max(3),
  // Discord shows a username with a leading "@" and ignores case when a person
  // types one, so both are accepted and stored the way Discord stores them.
  discord_username: z
    .string()
    .trim()
    .transform((value) => value.replace(/^@/, "").toLowerCase())
    .refine(
      (value) => value === "" || isDiscordUsername(value),
      "Discord username must be 2 to 32 characters and use only letters, numbers, underscores, and periods, with no two periods in a row.",
    )
    .optional(),
  show_in_lists: z.boolean().optional(),
});

const deleteAccountInputSchema = z.object({
  confirm: z
    .string()
    .trim()
    .toUpperCase()
    .pipe(z.literal("DELETE", { error: "Type DELETE to confirm." })),
});

export type AccountProfileDTO = z.output<typeof accountProfileDtoSchema>;
export type DashboardEventDTO = z.output<typeof dashboardEventDtoSchema> & {
  host_school: WithSchoolLogo<{ name: string; slug: string }>;
};
export type AccountTeamDTO = z.output<typeof accountTeamDtoSchema>;
export type UpdateProfileInput = z.input<typeof updateProfileInputSchema>;
export type DeleteAccountInput = z.input<typeof deleteAccountInputSchema>;
type AccountFormErrors = Record<string, string[] | undefined>;

export type AccountDashboardResult =
  | {
      status: "found";
      profile: AccountProfileDTO;
      dashboardEvents: {
        upcoming_rsvps: DashboardEventDTO[];
        followed_school_events: DashboardEventDTO[];
        interested_events: DashboardEventDTO[];
      };
      followedSchools: WithSchoolLogo<
        z.output<typeof followedSchoolsDtoSchema>["schools"][number]
      >[];
      teams: AccountTeamDTO[];
      unavailable: {
        dashboardEvents: boolean;
        followedSchools: boolean;
        teams: boolean;
      };
    }
  | { status: "unauthenticated" }
  | { status: "error"; message: "Account details are unavailable." };

export const sidebarFollowedSchoolLimit = 5;

type SidebarSchool = WithSchoolLogo<z.output<typeof schoolSummarySchema>>;

/**
 * The viewer's school context for the directory sidebar. A visitor, and a
 * viewer whose school data could not load, get the section links only.
 */
export type DirectorySidebarResult =
  | { status: "visitor" }
  | { status: "unavailable" }
  | {
      status: "found";
      homeSchool?: SidebarSchool;
      followedSchools: SidebarSchool[];
      moreFollowedSchools: boolean;
    };

export type AccountProfileResult =
  | { status: "found"; profile: AccountProfileDTO }
  | { status: "unauthenticated" }
  | { status: "error"; message: "Account details are unavailable." };

export type AccountMutationResult =
  | { status: "success"; message: string; redirectTo: string }
  | { status: "error"; message: string; fieldErrors?: AccountFormErrors };

type ValidatedAccountInput<T> =
  | { valid: true; value: T }
  | {
      valid: false;
      message: "Check the highlighted fields and try again.";
      fieldErrors: AccountFormErrors;
    };

export function validateUpdateProfileInput(
  input: UpdateProfileInput | FormData,
): ValidatedAccountInput<z.output<typeof updateProfileInputSchema>> {
  const candidate =
    input instanceof FormData
      ? {
          name: formString(input, "name"),
          bio: formString(input, "bio"),
          timezone: formString(input, "timezone"),
          social_links: socialLinksFromForm(input),
          // A form without the field sends no Discord username.
          ...(input.has("discord_username")
            ? { discord_username: formString(input, "discord_username") }
            : {}),
          // An unchecked checkbox sends nothing, so the form puts a "false"
          // before it and the last value wins. A form without the field
          // leaves the setting alone.
          ...(input.has("show_in_lists")
            ? { show_in_lists: input.getAll("show_in_lists").at(-1) === "true" }
            : {}),
        }
      : input;
  const parsed = updateProfileInputSchema.safeParse(candidate);
  return parsed.success
    ? { valid: true, value: parsed.data }
    : validationFailure(parsed.error);
}

export function validateDeleteAccountInput(
  input: DeleteAccountInput | FormData,
): ValidatedAccountInput<z.output<typeof deleteAccountInputSchema>> {
  const candidate =
    input instanceof FormData
      ? { confirm: formString(input, "confirm") }
      : input;
  const parsed = deleteAccountInputSchema.safeParse(candidate);
  return parsed.success
    ? { valid: true, value: parsed.data }
    : validationFailure(parsed.error);
}

function socialLinksFromForm(form: FormData) {
  return [0, 1, 2].flatMap((index) => {
    const label = formString(form, `social_label_${index}`);
    const url = formString(form, `social_url_${index}`);
    return label || url ? [{ label, url }] : [];
  });
}

function validationFailure(error: z.ZodError): ValidatedAccountInput<never> {
  const fieldErrors: AccountFormErrors = {};
  for (const issue of error.issues) {
    const [root, index, field] = issue.path;
    const key =
      root === "social_links" && typeof index === "number"
        ? `social_${String(field)}_${index}`
        : String(root ?? "form");
    const messages = fieldErrors[key] ?? [];
    if (!messages.includes(issue.message)) messages.push(issue.message);
    fieldErrors[key] = messages;
  }
  return {
    valid: false,
    message: "Check the highlighted fields and try again.",
    fieldErrors,
  };
}

function isHTTPURL(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isDiscordUsername(value: string): boolean {
  return /^[a-z0-9_.]{2,32}$/.test(value) && !value.includes("..");
}

function isIANATimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}
