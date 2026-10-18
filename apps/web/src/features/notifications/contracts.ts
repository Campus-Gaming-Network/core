import * as z from "zod";
import {
  pageNoticeKey,
  type PageNotice,
} from "../../components/page-notice.js";

const timestampSchema = z.iso.datetime({ offset: true });
const cursorSchema = z.string().trim().min(1).max(512);

export const notificationDtoSchema = z.object({
  id: z.uuid(),
  type: z.string(),
  title: z.string(),
  body: z.string(),
  event_slug: z.string().min(1).max(200).optional(),
  read_at: timestampSchema.optional(),
  created_at: timestampSchema,
});
export const notificationPageDtoSchema = z.object({
  notifications: z.array(notificationDtoSchema),
  next_cursor: z.string().max(512),
});
export const unreadCountDtoSchema = z.object({
  unread: z.number().int().nonnegative(),
});
export type NotificationDTO = z.output<typeof notificationDtoSchema>;

/** One inbox entry as the page shows it, its time in the viewer's zone. */
export type InboxEntry = NotificationDTO & { createdLabel: string };

export type InboxResult =
  | { status: "ready"; entries: InboxEntry[]; nextCursor: string }
  | { status: "unauthenticated" }
  | { status: "unavailable" };

export type InboxMutationResult = { status: "success"; redirectTo: string };

export const inboxNotices = {
  "all-read": {
    message: "All notifications marked read.",
    severity: "success",
  },
  failed: {
    message: "We could not update your notifications. Please try again.",
    severity: "danger",
  },
} as const satisfies Record<string, PageNotice>;
export type InboxNotice = keyof typeof inboxNotices;

export function validateInboxSearch(search: Record<string, unknown>): {
  after?: string;
  notice?: InboxNotice;
} {
  const after = cursorSchema.safeParse(search.after);
  const notice = pageNoticeKey(inboxNotices, search.notice);
  return {
    ...(after.success ? { after: after.data } : {}),
    ...(notice ? { notice } : {}),
  };
}

const markReadInputSchema = z.object({
  notification_id: z.uuid(),
  event_slug: z.string().trim().max(200).optional(),
});
export type MarkReadInput = z.output<typeof markReadInputSchema>;

/** The Open or Mark as read form; `event_slug` opens that event afterwards. */
export function validateMarkReadInput(
  input: object | FormData,
): MarkReadInput | undefined {
  const value = (field: string) => {
    const raw =
      input instanceof FormData
        ? input.get(field)
        : (input as Record<string, unknown>)[field];
    return typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
  };
  const eventSlug = value("event_slug");
  const parsed = markReadInputSchema.safeParse({
    notification_id: value("notification_id"),
    ...(eventSlug ? { event_slug: eventSlug } : {}),
  });
  return parsed.success ? parsed.data : undefined;
}
