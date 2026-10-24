import * as z from "zod";

const identifierSchema = z.string().trim().min(1).max(200);
const cursorSchema = z.string().trim().min(1).max(512);

/** How many entries the event page's Updates section shows. */
export const eventUpdatesPreviewSize = 3;
/** How many entries a page of the full log shows. */
export const eventActivityPageSize = 20;

export const eventActivityActions = [
  "event.created",
  "event.updated",
  "event.cancelled",
  "event.organizer_joined",
  "event.organizer_removed",
  "event.organizer_left",
  "event.creator_transferred",
] as const;

/**
 * One changed field of an edit. `before` and `after` are absent for a field
 * the log records as changed only. Their shape depends on the field, so they
 * stay plain JSON here and presentation reads them field by field.
 */
const activityChangeSchema = z.object({
  field: z.string().min(1).max(40),
  before: z.json().optional(),
  after: z.json().optional(),
});

const activityEntrySchema = z.object({
  id: identifierSchema,
  action: z.enum(eventActivityActions),
  occurred_at: z.iso.datetime({ offset: true }),
  visibility: z.enum(["public", "editors"]),
  changes: z.array(activityChangeSchema),
  // Editors only; null for an account deleted since.
  actor: z
    .object({ name: z.string(), public_id: identifierSchema })
    .nullable()
    .optional(),
});

export const eventActivityResponseDtoSchema = z.object({
  entries: z.array(activityEntrySchema),
  next_cursor: cursorSchema.optional(),
});

export const eventActivityInputSchema = z.object({
  slug: identifierSchema,
  limit: z.number().int().min(1).max(50),
  after: cursorSchema.optional(),
});

export type EventActivityEntry = z.output<typeof activityEntrySchema>;
export type EventActivityChange = z.output<typeof activityChangeSchema>;
export type EventActivityPage = z.output<typeof eventActivityResponseDtoSchema>;
export type EventActivityInput = z.output<typeof eventActivityInputSchema>;

export type EventActivityResult =
  | { status: "found"; page: EventActivityPage }
  | { status: "not_found" }
  | { status: "unavailable" };

/** The full log's query string: the cursor of an older page. */
export type EventActivitySearch = { after?: string };

export function validateEventActivitySearch(
  search: Record<string, unknown>,
): EventActivitySearch {
  const after = cursorSchema.safeParse(search.after);
  return after.success ? { after: after.data } : {};
}
