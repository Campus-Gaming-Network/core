import * as z from "zod";

const identifierSchema = z.string().trim().min(1);
const timestampSchema = z.iso.datetime({ offset: true });
const nonNegativeIntegerSchema = z.number().int().nonnegative();

export const eventRSVPSchema = z.enum(["yes", "maybe", "no"]);

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

const eventOrganizerSchema = z.object({
  id: identifierSchema,
  name: z.string(),
  role: z.enum(["creator", "organizer"]),
  verification_level: identifierSchema,
  role_indicators: z.array(z.string()).optional()
});

/**
 * The only event shape allowed to cross the Start server-function boundary.
 * Zod strips additive Go fields, so unlock tokens, session state, and internal
 * BFF headers cannot accidentally become part of the serialized DTO.
 */
export const eventDtoSchema = z.object({
  id: identifierSchema,
  title: z.string(),
  slug: identifierSchema,
  description: z.string(),
  visibility: z.enum(["public", "unlisted", "private"]),
  format: z.enum(["online", "in_person", "hybrid"]),
  starts_at: timestampSchema,
  ends_at: timestampSchema,
  timezone: identifierSchema,
  location_name: z.string().optional(),
  address: z.string().optional(),
  online_url: z.string().optional(),
  capacity: z.number().int().positive().optional(),
  rsvp_yes_count: nonNegativeIntegerSchema,
  interest_count: nonNegativeIntegerSchema,
  lifecycle: z.enum(["upcoming", "happening_now", "ended", "full"]),
  recurrence_rule: z.enum(["weekly", "biweekly", "monthly"]).optional(),
  recurrence_until: timestampSchema.optional(),
  is_paid: z.boolean(),
  payment_note: z.string().optional(),
  payment_url: z.string().optional(),
  host_school: schoolSummarySchema,
  games: z.array(gameSummarySchema),
  organizers: z.array(eventOrganizerSchema).optional(),
  viewer_rsvp: eventRSVPSchema.optional(),
  viewer_interested: z.boolean().optional(),
  viewer_can_edit: z.boolean().optional()
});

export const lockedEventDtoSchema = z.object({
  slug: identifierSchema,
  visibility: z.literal("private"),
  locked: z.literal(true)
});

export const eventDetailDtoSchema = z.union([
  eventDtoSchema,
  lockedEventDtoSchema
]);

export const eventSlugInputSchema = z.object({
  slug: identifierSchema
});

export const loginInputSchema = z.object({
  email: z.email("Enter a valid email address."),
  password: z.string().min(1, "Password is required."),
  next: z.string().optional()
});

export const unlockEventInputSchema = eventSlugInputSchema.extend({
  password: z.string().min(1, "Password is required.")
});

export const rsvpEventInputSchema = eventSlugInputSchema.extend({
  response: eventRSVPSchema
});

export type EventDTO = z.output<typeof eventDtoSchema>;
export type LockedEventDTO = z.output<typeof lockedEventDtoSchema>;
export type EventDetailDTO = z.output<typeof eventDetailDtoSchema>;
export type EventRSVP = z.output<typeof eventRSVPSchema>;
export type EventSlugInput = z.output<typeof eventSlugInputSchema>;
export type LoginInput = z.output<typeof loginInputSchema>;
export type UnlockEventInput = z.output<typeof unlockEventInputSchema>;
export type RSVPEventInput = z.output<typeof rsvpEventInputSchema>;

export type OperationFailure = {
  status: "error";
  message: string;
};

export type GetEventDetailResult =
  | { status: "found"; event: EventDetailDTO }
  | { status: "not_found" }
  | OperationFailure;

export type NavigationSessionDTO = {
  authenticated: boolean;
};

export type EventViewerSessionResult =
  | { status: "authenticated"; authenticated: true }
  | { status: "unauthenticated"; authenticated: false }
  | {
      status: "unavailable";
      message: "We could not verify your session. Please try again.";
    };

export type LoginResult =
  | { status: "success"; authenticated: true; redirectTo: string }
  | OperationFailure;

export type UnlockEventResult =
  | { status: "success"; event: EventDTO; redirectTo: string }
  | OperationFailure;

export type RSVPEventResult =
  | { status: "success"; event: EventDTO; redirectTo: string }
  | OperationFailure;

export type ValidatedServerInput<T> =
  | { valid: true; value: T }
  | { valid: false; slug?: string };

export function validateLoginServerInput(
  input: LoginInput | FormData
): ValidatedServerInput<LoginInput> {
  const candidate = input instanceof FormData
    ? {
        email: formValue(input, "email"),
        password: formValue(input, "password"),
        next: formValue(input, "next") || undefined
      }
    : input;
  const parsed = loginInputSchema.safeParse(candidate);
  return parsed.success ? { valid: true, value: parsed.data } : { valid: false };
}

export function validateUnlockServerInput(
  input: UnlockEventInput | FormData
): ValidatedServerInput<UnlockEventInput> {
  const candidate = input instanceof FormData
    ? { slug: formValue(input, "slug"), password: formValue(input, "password") }
    : input;
  const parsed = unlockEventInputSchema.safeParse(candidate);
  return parsed.success
    ? { valid: true, value: parsed.data }
    : { valid: false, slug: validFailureSlug(candidate) };
}

export function validateRSVPServerInput(
  input: RSVPEventInput | FormData
): ValidatedServerInput<RSVPEventInput> {
  const candidate = input instanceof FormData
    ? { slug: formValue(input, "slug"), response: formValue(input, "response") }
    : input;
  const parsed = rsvpEventInputSchema.safeParse(candidate);
  return parsed.success
    ? { valid: true, value: parsed.data }
    : { valid: false, slug: validFailureSlug(candidate) };
}

function formValue(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function validFailureSlug(candidate: unknown): string | undefined {
  if (typeof candidate !== "object" || candidate === null || !("slug" in candidate)) {
    return undefined;
  }
  const parsed = identifierSchema.safeParse(candidate.slug);
  return parsed.success ? parsed.data : undefined;
}
