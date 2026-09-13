import * as z from "zod";

const identifierSchema = z.string().trim().min(1);
const reportTargetSchema = z
  .string()
  .trim()
  .min(1, "User is required.")
  .max(200, "User must be 200 characters or fewer.");
const reportReasonSchema = z
  .string()
  .trim()
  .min(1, "Reason is required.")
  .max(2000, "Reason must be 2000 characters or fewer.");

const schoolSummarySchema = z.object({
  id: identifierSchema,
  name: z.string(),
  slug: identifierSchema,
  city: z.string().optional(),
  state: z.string().optional()
});

const socialLinkSchema = z.object({
  id: identifierSchema.optional(),
  label: z.string(),
  url: z.string()
});

/** Public allowlist for loader serialization. */
export const publicProfileDtoSchema = z.object({
  id: identifierSchema,
  name: z.string(),
  avatar_url: z.string().optional(),
  bio: z.string().optional(),
  verification_level: z.string().min(1),
  home_school_id: identifierSchema,
  home_school: schoolSummarySchema.optional(),
  social_links: z.array(socialLinkSchema).optional(),
  role_indicators: z.array(z.string()).optional()
});

export const publicProfileInputSchema = z.object({
  id: identifierSchema
});

export const reportUserInputSchema = z.object({
  userID: reportTargetSchema,
  reason: reportReasonSchema
});

const reportNotices = new Set(["submitted", "failed"] as const);

export type PublicProfileDTO = z.output<typeof publicProfileDtoSchema>;
export type PublicProfileInput = z.output<typeof publicProfileInputSchema>;
export type ReportUserInput = z.output<typeof reportUserInputSchema>;
export type ReportUserNotice = "submitted" | "failed";
export type ViewerRelationship = "anonymous" | "self" | "other";

export type ReportUserResult =
  | { status: "success"; message: "Report submitted for review." }
  | {
      status: "error";
      message: string;
      fieldErrors?: Record<string, string[] | undefined>;
    };

export type ValidatedReportUserInput =
  | { valid: true; value: ReportUserInput }
  | {
      valid: false;
      message: "Check the highlighted fields and try again.";
      fieldErrors: Record<string, string[] | undefined>;
      userID?: string;
    };

export type PublicProfilePageResult =
  | {
      status: "found";
      profile: PublicProfileDTO;
      viewer: ViewerRelationship;
    }
  | { status: "not_found" }
  | {
      status: "error";
      message: "We could not load this profile. Please try again.";
    };

export function validateReportUserServerInput(
  input: ReportUserInput | FormData
): ValidatedReportUserInput {
  const candidate = {
    userID: normalizedInputValue(input, "user_id", "userID"),
    reason: normalizedInputValue(input, "reason")
  };
  const parsed = reportUserInputSchema.safeParse(candidate);
  if (parsed.success) {
    return { valid: true, value: parsed.data };
  }

  const fieldErrors: Record<string, string[] | undefined> = {};
  for (const issue of parsed.error.issues) {
    const field = typeof issue.path[0] === "string" ? issue.path[0] : "_form";
    const messages = fieldErrors[field] ?? [];
    if (!messages.includes(issue.message)) messages.push(issue.message);
    fieldErrors[field] = messages;
  }

  const target = reportTargetSchema.safeParse(candidate.userID);
  return {
    valid: false,
    message: "Check the highlighted fields and try again.",
    fieldErrors,
    ...(target.success ? { userID: target.data } : {})
  };
}

export function validatePublicProfileSearch(
  search: Record<string, unknown>
): { report?: ReportUserNotice } {
  const value = Array.isArray(search.report) ? search.report[0] : search.report;
  return typeof value === "string" &&
    reportNotices.has(value as ReportUserNotice)
    ? { report: value as ReportUserNotice }
    : {};
}

export function reportUserNativeDestination(
  userID: string | undefined,
  notice: ReportUserNotice
): string {
  const target = reportTargetSchema.safeParse(userID);
  return target.success
    ? `/users/${encodeURIComponent(target.data)}?report=${notice}`
    : "/";
}

function normalizedInputValue(
  input: ReportUserInput | FormData,
  formName: string,
  objectName = formName
): string {
  const value = input instanceof FormData
    ? input.get(formName)
    : input[objectName as keyof ReportUserInput];
  return typeof value === "string" ? value : "";
}
