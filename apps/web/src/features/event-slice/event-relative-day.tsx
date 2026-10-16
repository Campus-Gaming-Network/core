import { rootRouteId, useLoaderData } from "@tanstack/react-router";
import type { EventBrowseItemDTO } from "./contracts.js";
import { eventRelativeDay } from "./presentation";

/**
 * "Today" or "Tomorrow" for an upcoming event, else undefined. It is judged
 * in the event's own time zone, so it depends only on the moment, and it uses
 * the moment the page was rendered (the root loader's `renderedAt`), not the
 * live clock. The browser hydrates with the server's value, so the label is
 * in the server HTML and never swaps in after load; a later navigation
 * renders with a fresh moment.
 */
export function useEventRelativeDay(
  event: Pick<EventBrowseItemDTO, "starts_at" | "timezone">,
): string | undefined {
  const renderedAt = useLoaderData({
    from: rootRouteId,
    select: (data) => data.renderedAt,
  });
  return eventRelativeDay(event, new Date(renderedAt));
}
