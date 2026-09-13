import * as z from "zod";
import { localDateTimeToInstant } from "./event-time.js";

const identifierSchema = z.string().trim().min(1).max(200);
const timestampSchema = z.iso.datetime({ offset: true });
const nonNegativeIntegerSchema = z.number().int().nonnegative();
const eventFilterSchema = z.string().trim().min(1).max(200);
const eventCursorSchema = z.string().trim().min(1).max(1024);
const eventSchoolQuerySchema = z.string().trim().min(1).max(120);

export const eventRSVPSchema = z.enum(["yes", "maybe", "no"]);
export const eventFormatSchema = z.enum(["online", "in_person", "hybrid"]);
export const eventVisibilitySchema = z.enum(["public", "unlisted", "private"]);
export const recurrenceRuleSchema = z.enum(["weekly", "biweekly", "monthly"]);

export const schoolSummarySchema = z.object({
  id: identifierSchema,
  name: z.string(),
  slug: identifierSchema,
  city: z.string().optional(),
  state: z.string().optional()
});

export const gameSummaryDtoSchema = z.object({
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
  format: eventFormatSchema,
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
  games: z.array(gameSummaryDtoSchema),
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

export const eventBrowseItemDtoSchema = z.object({
  id: identifierSchema,
  title: z.string(),
  slug: identifierSchema,
  format: eventFormatSchema,
  starts_at: timestampSchema,
  ends_at: timestampSchema,
  timezone: identifierSchema,
  location_name: z.string().optional(),
  address: z.string().optional(),
  online_url: z.string().optional(),
  lifecycle: z.enum(["upcoming", "happening_now", "ended", "full"]),
  host_school: z.object({ name: z.string() }),
  games: z.array(z.object({ name: z.string() }))
});

export const eventsBrowseResponseDtoSchema = z.object({
  events: z.array(eventBrowseItemDtoSchema),
  limit: nonNegativeIntegerSchema,
  has_more: z.boolean(),
  has_previous: z.boolean(),
  next_cursor: eventCursorSchema.optional(),
  previous_cursor: eventCursorSchema.optional()
});

export const gamesBrowseResponseDtoSchema = z.object({
  games: z.array(gameSummaryDtoSchema)
});

export const eventsBrowseInputSchema = z.object({
  game: eventFilterSchema.optional(),
  school: eventFilterSchema.optional(),
  format: eventFormatSchema.optional(),
  after: eventCursorSchema.optional(),
  before: eventCursorSchema.optional()
});

export const eventSlugInputSchema = z.object({
  slug: identifierSchema
});

export const loginInputSchema = z.object({
  email: z.string().trim().max(
    320,
    "Email must be 320 characters or fewer."
  ).pipe(z.email("Enter a valid email address.")),
  password: z.string().trim()
    .min(1, "Password is required.")
    .max(256, "Password must be 256 characters or fewer."),
  next: z.string().trim().max(2048).optional()
});

export const unlockEventInputSchema = eventSlugInputSchema.extend({
  password: z.string().trim()
    .min(8, "Password must be at least 8 characters.")
    .max(256, "Password must be 256 characters or fewer.")
});

export const rsvpEventInputSchema = eventSlugInputSchema.extend({
  response: z.string().trim().pipe(eventRSVPSchema)
});

const requiredText = (label: string, maximum: number) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required.`)
    .max(maximum, `${label} must be ${maximum} characters or fewer.`);

const optionalText = (label: string, maximum: number) =>
  z
    .string()
    .trim()
    .max(maximum, `${label} must be ${maximum} characters or fewer.`);

const optionalHTTPURL = (label: string, maximum: number) =>
  optionalText(label, maximum).refine(
    (value) => value === "" || isHTTPURL(value),
    `${label} must be a valid HTTP or HTTPS URL.`
  );

const localDateTimeSchema = z
  .string()
  .trim()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/,
    "Choose a valid local date and time."
  );

const timeZoneSchema = z
  .string()
  .trim()
  .min(1, "Time zone is required.")
  .max(100, "Time zone must be 100 characters or fewer.")
  .refine(validIANATimeZone, "Enter a valid IANA time zone.");

const eventMutableInputSchema = z.object({
  title: requiredText("Title", 120),
  description: optionalText("Description", 5000),
  host_school_id: z.string().trim().min(1, "Choose a host school."),
  game_ids: z.array(identifierSchema).min(1, "Choose at least one game."),
  visibility: eventVisibilitySchema,
  format: eventFormatSchema,
  starts_at: localDateTimeSchema,
  ends_at: localDateTimeSchema,
  timezone: timeZoneSchema,
  location_name: optionalText("Location name", 200),
  address: optionalText("Address", 1000),
  online_url: optionalHTTPURL("Online URL", 500),
  private_password: z.string().trim().max(
    256,
    "Private password must be 256 characters or fewer."
  ),
  capacity: z
    .number()
    .int()
    .positive("Capacity must be a positive whole number.")
    .optional(),
  is_paid: z.boolean(),
  payment_note: optionalText("Payment note", 1000),
  payment_url: optionalHTTPURL("Payment URL", 500)
});

const createEventInputSchema = eventMutableInputSchema.extend({
  recurrence_rule: z.union([recurrenceRuleSchema, z.literal("")]),
  recurrence_until: z
    .union([z.iso.date("Repeat-until date must be valid."), z.literal("")])
    .optional()
    .transform((value) => value || undefined)
});

const immutableRecurrenceMessage =
  "Recurrence settings cannot be changed after an event is created.";

const updateEventInputSchema = eventMutableInputSchema.extend({
  recurrence_rule: z
    .undefined({ error: immutableRecurrenceMessage })
    .optional(),
  recurrence_until: z
    .undefined({ error: immutableRecurrenceMessage })
    .optional()
});

export const createEventMutationInputSchema = createEventInputSchema
  .superRefine((event, context) => validateEventForm(event, context, "create"))
  .transform(convertEventTimes);

export const updateEventMutationInputSchema = updateEventInputSchema
  .superRefine((event, context) => validateEventForm(event, context, "update"))
  .transform((event) => convertEventTimes(eventMutableInputSchema.parse(event)));

export const reportEventInputSchema = eventSlugInputSchema.extend({
  reason: requiredText("Reason", 2000)
});

export const eventInterestInputSchema = eventSlugInputSchema.extend({
  interested: z.boolean()
});

export const eventFormPageInputSchema = z.object({
  schoolQuery: z.string().trim().max(120)
});

export const eventFormViewerDtoSchema = z.object({
  home_school_id: identifierSchema,
  home_school: schoolSummarySchema.optional(),
  timezone: identifierSchema
});

export const eventFormSchoolsResponseDtoSchema = z.object({
  schools: z.array(schoolSummarySchema),
  limit: nonNegativeIntegerSchema,
  offset: nonNegativeIntegerSchema,
  has_more: z.boolean()
});

export const idResponseDtoSchema = z.object({ id: identifierSchema });
export const emptyResponseDtoSchema = z.undefined();

export type EventDTO = z.output<typeof eventDtoSchema>;
export type LockedEventDTO = z.output<typeof lockedEventDtoSchema>;
export type EventDetailDTO = z.output<typeof eventDetailDtoSchema>;
export type EventBrowseItemDTO = z.output<typeof eventBrowseItemDtoSchema>;
export type EventsBrowseInput = z.output<typeof eventsBrowseInputSchema>;
export type EventGameDTO = z.output<typeof gameSummaryDtoSchema>;
export type EventRSVP = z.output<typeof eventRSVPSchema>;
export type EventSlugInput = z.output<typeof eventSlugInputSchema>;
export type LoginInput = z.output<typeof loginInputSchema>;
export type UnlockEventInput = z.output<typeof unlockEventInputSchema>;
export type RSVPEventInput = z.output<typeof rsvpEventInputSchema>;
export type CreateEventInput = z.input<typeof createEventMutationInputSchema>;
export type EventMutationPayload = z.output<typeof eventMutableInputSchema> & {
  recurrence_rule?: z.output<typeof recurrenceRuleSchema> | "";
  recurrence_until?: string;
};
export type UpdateEventInput = z.input<typeof updateEventMutationInputSchema> & {
  slug: string;
};
export type ReportEventInput = z.output<typeof reportEventInputSchema>;
export type EventInterestInput = z.output<typeof eventInterestInputSchema>;
export type EventFormSchoolDTO = z.output<typeof schoolSummarySchema>;

export type FormFieldErrors = Record<string, string[] | undefined>;

export type OperationFailure = {
  status: "error";
  message: string;
  fieldErrors?: FormFieldErrors;
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

export type EventMutationResult =
  | { status: "success"; event: EventDTO; redirectTo: string }
  | OperationFailure;

export type ReportEventResult =
  | { status: "success"; message: "Report submitted for review." }
  | OperationFailure;

export type EventRedirectResult = { redirectTo: string };

export type NewEventPageResult =
  | {
      status: "ready";
      defaultSchoolID: string;
      defaultSchool?: EventFormSchoolDTO;
      defaultTimeZone: string;
      games: EventGameDTO[];
      schools: EventFormSchoolDTO[];
      schoolSearchFailed: boolean;
    }
  | { status: "unauthenticated" }
  | { status: "error"; message: "Event creation is unavailable." };

export type EditEventPageResult =
  | {
      status: "ready";
      event: EventDTO;
      games: EventGameDTO[];
      schools: EventFormSchoolDTO[];
      schoolSearchFailed: boolean;
    }
  | { status: "unauthenticated" }
  | { status: "not_found" }
  | { status: "denied"; reason: "locked" | "forbidden" }
  | { status: "error"; message: "Event editing is unavailable." };

export type NewEventSearch = {
  school_q?: string;
  event?: "failed";
};

export function validateNewEventSearch(
  search: Record<string, unknown>
): NewEventSearch {
  const schoolQuery = boundedSearchValue(search.school_q, eventSchoolQuerySchema);
  const event = boundedSearchValue(search.event, eventFilterSchema);
  return {
    ...(schoolQuery ? { school_q: schoolQuery } : {}),
    ...(event === "failed" ? { event } : {})
  };
}

export type EventsBrowseResult = {
  events: EventBrowseItemDTO[];
  games: EventGameDTO[];
  limit: number;
  has_more: boolean;
  has_previous: boolean;
  next_cursor?: string;
  previous_cursor?: string;
  eventsUnavailable: boolean;
  gamesUnavailable: boolean;
};

export type EventNotice =
  | "cancel-failed"
  | "cancelled"
  | "created"
  | "delete-failed"
  | "deleted"
  | "failed"
  | "interest-added"
  | "interest-failed"
  | "interest-removed"
  | "report-failed"
  | "report-submitted"
  | "rsvp-failed"
  | "rsvp-updated"
  | "unlock-failed"
  | "unlocked"
  | "updated";

export type EventsSearch = EventsBrowseInput & {
  event?: EventNotice;
};

const eventNotices = new Set<EventNotice>([
  "cancel-failed",
  "cancelled",
  "created",
  "delete-failed",
  "deleted",
  "failed",
  "interest-added",
  "interest-failed",
  "interest-removed",
  "report-failed",
  "report-submitted",
  "rsvp-failed",
  "rsvp-updated",
  "unlock-failed",
  "unlocked",
  "updated"
]);

export function validateEventsSearch(
  search: Record<string, unknown>
): EventsSearch {
  const game = boundedSearchValue(search.game, eventFilterSchema);
  const school = boundedSearchValue(search.school, eventFilterSchema);
  const formatCandidate = boundedSearchValue(search.format, eventFilterSchema);
  const format = eventFormatSchema.safeParse(formatCandidate);
  const after = boundedSearchValue(search.after, eventCursorSchema);
  const before = boundedSearchValue(search.before, eventCursorSchema);
  const event = boundedSearchValue(search.event, eventFilterSchema);

  return {
    ...(game ? { game } : {}),
    ...(school ? { school } : {}),
    ...(format.success ? { format: format.data } : {}),
    ...(after ? { after } : {}),
    ...(before ? { before } : {}),
    ...(event && eventNotices.has(event as EventNotice)
      ? { event: event as EventNotice }
      : {})
  };
}

export function eventsBrowseInput(search: EventsSearch): EventsBrowseInput {
  return {
    ...(search.game ? { game: search.game } : {}),
    ...(search.school ? { school: search.school } : {}),
    ...(search.format ? { format: search.format } : {}),
    ...(search.after ? { after: search.after } : {}),
    ...(search.before ? { before: search.before } : {})
  };
}

export type ValidatedServerInput<T> =
  | { valid: true; value: T }
  | {
      valid: false;
      message: "Check the highlighted fields and try again.";
      fieldErrors: FormFieldErrors;
      slug?: string;
    };

export function validateLoginServerInput(
  input: LoginInput | FormData
): ValidatedServerInput<LoginInput> {
  const next = normalizedInputValue(input, "next");
  const candidate = {
    email: normalizedInputValue(input, "email"),
    password: normalizedInputValue(input, "password"),
    ...(next ? { next } : {})
  };
  const parsed = loginInputSchema.safeParse(candidate);
  return parsed.success
    ? { valid: true, value: parsed.data }
    : validationFailure(parsed.error);
}

export function validateUnlockServerInput(
  input: UnlockEventInput | FormData
): ValidatedServerInput<UnlockEventInput> {
  const candidate = {
    slug: normalizedInputValue(input, "slug"),
    password: normalizedInputValue(input, "password")
  };
  const parsed = unlockEventInputSchema.safeParse(candidate);
  return parsed.success
    ? { valid: true, value: parsed.data }
    : validationFailure(parsed.error, validFailureSlug(candidate));
}

export function validateRSVPServerInput(
  input: RSVPEventInput | FormData
): ValidatedServerInput<RSVPEventInput> {
  const candidate = {
    slug: normalizedInputValue(input, "slug"),
    response: normalizedInputValue(input, "response")
  };
  const parsed = rsvpEventInputSchema.safeParse(candidate);
  return parsed.success
    ? { valid: true, value: parsed.data }
    : validationFailure(parsed.error, validFailureSlug(candidate));
}

export function validateCreateEventServerInput(
  input: CreateEventInput | FormData
): ValidatedServerInput<EventMutationPayload> {
  const parsed = createEventMutationInputSchema.safeParse(
    eventWriteCandidate(input)
  );
  return parsed.success
    ? { valid: true, value: parsed.data }
    : validationFailure(parsed.error);
}

export function validateUpdateEventServerInput(
  input: UpdateEventInput | FormData
): ValidatedServerInput<EventMutationPayload & { slug: string }> {
  const candidate = eventWriteCandidate(input);
  const slug = normalizedInputValue(input, "slug");
  const parsedSlug = eventSlugInputSchema.safeParse({ slug });
  const parsedEvent = updateEventMutationInputSchema.safeParse(candidate);

  if (!parsedSlug.success || !parsedEvent.success) {
    const issues = [
      ...(parsedSlug.success ? [] : parsedSlug.error.issues),
      ...(parsedEvent.success ? [] : parsedEvent.error.issues)
    ];
    return validationFailure(
      new z.ZodError(issues),
      parsedSlug.success ? parsedSlug.data.slug : undefined
    );
  }

  return {
    valid: true,
    value: { slug: parsedSlug.data.slug, ...parsedEvent.data }
  };
}

export function validateReportEventServerInput(
  input: ReportEventInput | FormData
): ValidatedServerInput<ReportEventInput> {
  const candidate = {
    slug: normalizedInputValue(input, "slug"),
    reason: normalizedInputValue(input, "reason")
  };
  const parsed = reportEventInputSchema.safeParse(candidate);
  return parsed.success
    ? { valid: true, value: parsed.data }
    : validationFailure(parsed.error, validFailureSlug(candidate));
}

export function validateEventInterestServerInput(
  input: EventInterestInput | FormData
): ValidatedServerInput<EventInterestInput> {
  const rawInterested = normalizedInputValue(input, "interested");
  const interested =
    !(input instanceof FormData) && typeof input.interested === "boolean"
      ? input.interested
      : rawInterested === "true"
        ? true
        : rawInterested === "false"
          ? false
          : rawInterested;
  const candidate = {
    slug: normalizedInputValue(input, "slug"),
    interested
  };
  const parsed = eventInterestInputSchema.safeParse(candidate);
  return parsed.success
    ? { valid: true, value: parsed.data }
    : validationFailure(parsed.error, validFailureSlug(candidate));
}

export function validateCancelEventServerInput(
  input: EventSlugInput | FormData
): ValidatedServerInput<EventSlugInput> {
  const candidate = { slug: normalizedInputValue(input, "slug") };
  const parsed = eventSlugInputSchema.safeParse(candidate);
  return parsed.success
    ? { valid: true, value: parsed.data }
    : validationFailure(parsed.error);
}

function eventWriteCandidate(input: CreateEventInput | UpdateEventInput | FormData) {
  return {
    title: normalizedInputValue(input, "title"),
    description: normalizedInputValue(input, "description"),
    host_school_id: normalizedInputValue(input, "host_school_id"),
    game_ids: normalizedInputValues(input, "game_ids"),
    visibility: normalizedInputValue(input, "visibility"),
    format: normalizedInputValue(input, "format"),
    starts_at: normalizedInputValue(input, "starts_at"),
    ends_at: normalizedInputValue(input, "ends_at"),
    timezone:
      normalizedInputValue(input, "timezone") || "America/Los_Angeles",
    location_name: normalizedInputValue(input, "location_name"),
    address: normalizedInputValue(input, "address"),
    online_url: normalizedInputValue(input, "online_url"),
    private_password: normalizedInputValue(input, "private_password"),
    capacity: normalizedCapacity(input),
    is_paid: normalizedCheckbox(input, "is_paid"),
    payment_note: normalizedInputValue(input, "payment_note"),
    payment_url: normalizedInputValue(input, "payment_url"),
    ...(hasInputField(input, "recurrence_rule")
      ? { recurrence_rule: normalizedInputValue(input, "recurrence_rule") }
      : {}),
    ...(hasInputField(input, "recurrence_until")
      ? { recurrence_until: normalizedInputValue(input, "recurrence_until") }
      : {})
  };
}

function validateEventForm(
  event: z.infer<typeof eventMutableInputSchema> & {
    recurrence_rule?: z.infer<typeof recurrenceRuleSchema> | "";
    recurrence_until?: string;
  },
  context: z.RefinementCtx,
  mode: "create" | "update"
): void {
  const startsAt = localDateTimeToInstant(event.starts_at, event.timezone);
  const endsAt = localDateTimeToInstant(event.ends_at, event.timezone);

  addLocalTimeIssue(startsAt, "Start", "starts_at", context);
  addLocalTimeIssue(endsAt, "End", "ends_at", context);

  if (
    startsAt.success &&
    endsAt.success &&
    Date.parse(endsAt.instant) <= Date.parse(startsAt.instant)
  ) {
    context.addIssue({
      code: "custom",
      message: "End time must be after start time.",
      path: ["ends_at"]
    });
  }

  if (event.visibility === "private") {
    if (mode === "create" && event.private_password.length < 8) {
      context.addIssue({
        code: "custom",
        message: "Private events require a password of at least 8 characters.",
        path: ["private_password"]
      });
    } else if (
      mode === "update" &&
      event.private_password !== "" &&
      event.private_password.length < 8
    ) {
      context.addIssue({
        code: "custom",
        message: "A new private-event password must be at least 8 characters.",
        path: ["private_password"]
      });
    }
  } else if (event.private_password !== "") {
    context.addIssue({
      code: "custom",
      message: "Only private events may have a private password.",
      path: ["private_password"]
    });
  }

  if (mode === "update") return;

  if (!event.recurrence_rule && event.recurrence_until) {
    context.addIssue({
      code: "custom",
      message: "Choose a repeat interval for this end date.",
      path: ["recurrence_rule"]
    });
  }
  if (event.recurrence_rule && !event.recurrence_until) {
    context.addIssue({
      code: "custom",
      message: "Choose when the recurrence ends.",
      path: ["recurrence_until"]
    });
  }
  if (event.recurrence_rule && event.recurrence_until) {
    const eventEndDate = event.ends_at.slice(0, 10);
    if (event.recurrence_until < eventEndDate) {
      context.addIssue({
        code: "custom",
        message: "Recurrence must end after the first event.",
        path: ["recurrence_until"]
      });
    }

    const startDate = new Date(`${event.starts_at.slice(0, 10)}T00:00:00Z`);
    if (Number.isFinite(startDate.getTime())) {
      startDate.setUTCFullYear(startDate.getUTCFullYear() + 1);
      if (event.recurrence_until > startDate.toISOString().slice(0, 10)) {
        context.addIssue({
          code: "custom",
          message: "Recurrence cannot extend more than one year.",
          path: ["recurrence_until"]
        });
      }
    }
  }
}

function convertEventTimes<T extends z.infer<typeof eventMutableInputSchema>>(
  event: T
) {
  const startsAt = localDateTimeToInstant(event.starts_at, event.timezone);
  const endsAt = localDateTimeToInstant(event.ends_at, event.timezone);
  if (!startsAt.success || !endsAt.success) return event;
  return { ...event, starts_at: startsAt.instant, ends_at: endsAt.instant };
}

function addLocalTimeIssue(
  result: ReturnType<typeof localDateTimeToInstant>,
  label: "Start" | "End",
  path: "starts_at" | "ends_at",
  context: z.RefinementCtx
): void {
  if (result.success || result.reason === "invalid_timezone") return;
  const message =
    result.reason === "nonexistent"
      ? `${label} time does not exist because clocks move forward. Choose another time.`
      : result.reason === "ambiguous"
        ? `${label} time occurs twice because clocks move back. Choose another time.`
        : `Choose a valid local ${label.toLowerCase()} date and time.`;
  context.addIssue({ code: "custom", message, path: [path] });
}

function isHTTPURL(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function validIANATimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function normalizedInputValue(
  input: FormData | object,
  name: string
): string {
  const value = input instanceof FormData
    ? input.get(name)
    : name in input
      ? Reflect.get(input, name)
      : undefined;
  return typeof value === "string" ? value.trim() : "";
}

function normalizedInputValues(input: FormData | object, name: string): string[] {
  const values = input instanceof FormData
    ? input.getAll(name)
    : name in input
      ? Reflect.get(input, name)
      : [];
  return (Array.isArray(values) ? values : [])
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim());
}

function normalizedCapacity(input: FormData | object): number | undefined {
  const value = input instanceof FormData
    ? input.get("capacity")
    : "capacity" in input
      ? Reflect.get(input, "capacity")
      : undefined;
  if (value === undefined || value === null || value === "") return undefined;
  return typeof value === "number" ? value : Number(value);
}

function normalizedCheckbox(input: FormData | object, name: string): boolean {
  if (input instanceof FormData) return input.has(name);
  return name in input && Reflect.get(input, name) === true;
}

function hasInputField(input: FormData | object, name: string): boolean {
  return input instanceof FormData
    ? input.has(name)
    : Object.prototype.hasOwnProperty.call(input, name);
}

function boundedSearchValue(
  value: unknown,
  schema: z.ZodType<string>
): string | undefined {
  const candidate = Array.isArray(value) ? value[0] : value;
  const parsed = schema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}

function validationFailure(
  error: z.ZodError,
  slug?: string
): Extract<ValidatedServerInput<never>, { valid: false }> {
  const fieldErrors: FormFieldErrors = {};

  for (const issue of error.issues) {
    const field = typeof issue.path[0] === "string" ? issue.path[0] : "_form";
    const messages = fieldErrors[field] ?? [];
    if (!messages.includes(issue.message)) {
      messages.push(issue.message);
    }
    fieldErrors[field] = messages;
  }

  return {
    valid: false,
    message: "Check the highlighted fields and try again.",
    fieldErrors,
    ...(slug ? { slug } : {})
  };
}

function validFailureSlug(candidate: unknown): string | undefined {
  if (typeof candidate !== "object" || candidate === null || !("slug" in candidate)) {
    return undefined;
  }
  const parsed = identifierSchema.safeParse(candidate.slug);
  return parsed.success ? parsed.data : undefined;
}
