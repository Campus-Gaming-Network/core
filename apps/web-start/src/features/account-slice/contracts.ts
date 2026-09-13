import * as z from "zod";

const identifierSchema = z.string().trim().min(1);
const timestampSchema = z.iso.datetime({ offset: true });
const nonNegativeIntegerSchema = z.number().int().nonnegative();

const schoolSummarySchema = z.object({
  id: identifierSchema,
  name: z.string(),
  slug: identifierSchema,
  city: z.string().optional(),
  state: z.string().optional()
});

const gameSummarySchema = z.object({
  id: identifierSchema,
  name: z.string(),
  slug: identifierSchema
});

const socialLinkSchema = z.object({
  id: identifierSchema.optional(),
  label: z.string(),
  url: z.string()
});

export const accountProfileDtoSchema = z.object({
  id: identifierSchema,
  email: z.email(),
  email_verified_at: timestampSchema.optional(),
  verification_level: identifierSchema,
  name: z.string(),
  avatar_url: z.string().optional(),
  bio: z.string().optional(),
  timezone: identifierSchema,
  home_school_id: identifierSchema,
  home_school: schoolSummarySchema.optional(),
  social_links: z.array(socialLinkSchema).max(3).optional(),
  role_indicators: z.array(z.string()).optional()
});

export const dashboardEventDtoSchema = z.object({
  id: identifierSchema,
  title: z.string(),
  slug: identifierSchema,
  starts_at: timestampSchema,
  ends_at: timestampSchema,
  timezone: identifierSchema,
  lifecycle: z.enum(["upcoming", "happening_now", "ended", "full"]),
  host_school: schoolSummarySchema.pick({ name: true }),
  games: z.array(gameSummarySchema.pick({ name: true })),
  viewer_rsvp: z.enum(["yes", "maybe", "no"]).optional()
});

export const dashboardEventsDtoSchema = z.object({
  upcoming_rsvps: z.array(dashboardEventDtoSchema),
  followed_school_events: z.array(dashboardEventDtoSchema)
});

export const followedSchoolsDtoSchema = z.object({
  schools: z.array(schoolSummarySchema)
});

export const accountTeamDtoSchema = z.object({
  id: identifierSchema,
  name: z.string(),
  slug: identifierSchema,
  member_count: nonNegativeIntegerSchema,
  school: schoolSummarySchema.pick({ name: true }).optional(),
  games: z.array(gameSummarySchema.pick({ name: true })),
  viewer_role: z.enum(["owner", "captain", "member"]).optional()
});

export const myTeamsDtoSchema = z.object({
  teams: z.array(accountTeamDtoSchema),
  limit: nonNegativeIntegerSchema
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
    .refine(isHTTPURL, "Social link URL must use HTTP or HTTPS.")
});

export const updateProfileInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required.")
    .max(120, "Name must be 120 characters or fewer."),
  bio: z.string().trim().max(2000, "Bio must be 2000 characters or fewer."),
  timezone: timeZoneSchema,
  social_links: z.array(profileSocialLinkInputSchema).max(3)
});

export const deleteAccountInputSchema = z.object({
  confirm: z
    .string()
    .trim()
    .toUpperCase()
    .pipe(z.literal("DELETE", { error: "Type DELETE to confirm." }))
});

export type AccountProfileDTO = z.output<typeof accountProfileDtoSchema>;
export type DashboardEventDTO = z.output<typeof dashboardEventDtoSchema>;
export type AccountTeamDTO = z.output<typeof accountTeamDtoSchema>;
export type UpdateProfileInput = z.input<typeof updateProfileInputSchema>;
export type DeleteAccountInput = z.input<typeof deleteAccountInputSchema>;
export type AccountFormErrors = Record<string, string[] | undefined>;

export type AccountDashboardResult =
  | {
      status: "found";
      profile: AccountProfileDTO;
      dashboardEvents: z.output<typeof dashboardEventsDtoSchema>;
      followedSchools: z.output<typeof followedSchoolsDtoSchema>["schools"];
      teams: AccountTeamDTO[];
      unavailable: {
        dashboardEvents: boolean;
        followedSchools: boolean;
        teams: boolean;
      };
    }
  | { status: "unauthenticated" }
  | { status: "error"; message: "Account details are unavailable." };

export type AccountMutationResult =
  | { status: "success"; message: string; redirectTo: string }
  | { status: "error"; message: string; fieldErrors?: AccountFormErrors };

export type ValidatedAccountInput<T> =
  | { valid: true; value: T }
  | {
      valid: false;
      message: "Check the highlighted fields and try again.";
      fieldErrors: AccountFormErrors;
    };

export function validateUpdateProfileInput(
  input: UpdateProfileInput | FormData
): ValidatedAccountInput<z.output<typeof updateProfileInputSchema>> {
  const candidate = input instanceof FormData
    ? {
        name: formString(input, "name"),
        bio: formString(input, "bio"),
        timezone: formString(input, "timezone"),
        social_links: socialLinksFromForm(input)
      }
    : input;
  const parsed = updateProfileInputSchema.safeParse(candidate);
  return parsed.success
    ? { valid: true, value: parsed.data }
    : validationFailure(parsed.error);
}

export function validateDeleteAccountInput(
  input: DeleteAccountInput | FormData
): ValidatedAccountInput<z.output<typeof deleteAccountInputSchema>> {
  const candidate = input instanceof FormData
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
    const key = root === "social_links" && typeof index === "number"
      ? `social_${String(field)}_${index}`
      : String(root ?? "form");
    const messages = fieldErrors[key] ?? [];
    if (!messages.includes(issue.message)) messages.push(issue.message);
    fieldErrors[key] = messages;
  }
  return {
    valid: false,
    message: "Check the highlighted fields and try again.",
    fieldErrors
  };
}

function formString(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

function isHTTPURL(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isIANATimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}
