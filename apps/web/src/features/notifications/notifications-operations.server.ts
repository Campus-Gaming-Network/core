import {
  ApiContractError,
  ApiError,
  type ApiClient,
} from "../../server/api.server.js";
import { optionalViewerProfile } from "../../server/viewer.server.js";
import * as z from "zod";
import {
  notificationDtoSchema,
  notificationPageDtoSchema,
  unreadCountDtoSchema,
  type InboxMutationResult,
  type InboxResult,
  type MarkReadInput,
} from "./contracts.js";

type Dependencies = {
  api: ApiClient;
  cookieHeader: string;
  sessionCookieValue?: string;
  reportError?: (error: unknown) => void;
};

const inboxPath = "/notifications";
const markedResponseSchema = z.object({ marked: z.number().int() });

/** One page of the inbox, with each time shown in the viewer's own zone. */
export async function inboxOperation(
  { after }: { after?: string },
  {
    api,
    cookieHeader,
    sessionCookieValue,
    reportError = defaultErrorReporter,
  }: Dependencies,
): Promise<InboxResult> {
  try {
    const [profile, page] = await Promise.all([
      optionalViewerProfile({ api, cookieHeader, sessionCookieValue }),
      api({
        path: `/me/notifications${after ? `?${new URLSearchParams({ after })}` : ""}`,
        cookieHeader,
        cache: "no-store",
        responseSchema: notificationPageDtoSchema,
      }),
    ]);
    if (!profile) return { status: "unauthenticated" };
    const format = new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: profile.timezone,
    });
    return {
      status: "ready",
      entries: page.data.notifications.map((notification) => ({
        ...notification,
        createdLabel: format.format(new Date(notification.created_at)),
      })),
      nextCursor: page.data.next_cursor,
    };
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      return { status: "unauthenticated" };
    }
    reportError(error);
    return { status: "unavailable" };
  }
}

/** The header's unread count; undefined when it cannot be read. */
export async function unreadCountOperation({
  api,
  cookieHeader,
}: Pick<Dependencies, "api" | "cookieHeader">): Promise<number | undefined> {
  try {
    const { data } = await api({
      path: "/me/notifications/unread-count",
      cookieHeader,
      cache: "no-store",
      responseSchema: unreadCountDtoSchema,
    });
    return data.unread;
  } catch {
    // The badge is decorative; the header stays usable without it.
    return undefined;
  }
}

/**
 * Marks one notification read. Opening a notice about an event or a team
 * marks it and goes there; otherwise the inbox reloads.
 */
export async function markReadOperation(
  { notification_id, event_slug, team_slug }: MarkReadInput,
  { api, cookieHeader, reportError = defaultErrorReporter }: Dependencies,
): Promise<InboxMutationResult> {
  try {
    await api({
      path: `/me/notifications/${encodeURIComponent(notification_id)}/read`,
      method: "POST",
      cookieHeader,
      cache: "no-store",
      responseSchema: notificationDtoSchema,
    });
    return {
      status: "success",
      redirectTo: event_slug
        ? `/events/${encodeURIComponent(event_slug)}`
        : team_slug
          ? `/teams/${encodeURIComponent(team_slug)}`
          : inboxPath,
    };
  } catch (error) {
    reportError(error);
    return { status: "success", redirectTo: `${inboxPath}?notice=failed` };
  }
}

export async function markAllReadOperation({
  api,
  cookieHeader,
  reportError = defaultErrorReporter,
}: Dependencies): Promise<InboxMutationResult> {
  try {
    await api({
      path: "/me/notifications/read-all",
      method: "POST",
      cookieHeader,
      cache: "no-store",
      responseSchema: markedResponseSchema,
    });
    return { status: "success", redirectTo: `${inboxPath}?notice=all-read` };
  } catch (error) {
    reportError(error);
    return { status: "success", redirectTo: `${inboxPath}?notice=failed` };
  }
}

function defaultErrorReporter(error: unknown): void {
  if (error instanceof ApiContractError) {
    console.error("Notifications response contract violation", {
      path: error.path,
      issues: error.issues,
    });
  } else if (!(error instanceof ApiError)) {
    console.error("Notifications request failed");
  }
}
