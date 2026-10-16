import { useEffect, useState } from "react";
import { StatusLabel } from "../../components/status-label";
import type { EventBrowseItemDTO } from "./contracts.js";
import { eventRelativeDay } from "./presentation";

/**
 * A "Today" or "Tomorrow" tag for an upcoming event. It depends on the
 * viewer's clock, which the server and the browser read at different moments
 * (possibly either side of midnight), so it renders nothing on the server and
 * on the first client render, and fills in after hydration. Both renders then
 * produce the same markup and React reports no mismatch. A label that is only
 * a convenience, with the full date always in the row, can appear late.
 */
export function EventRelativeDay({
  event,
}: {
  event: Pick<EventBrowseItemDTO, "starts_at" | "timezone">;
}) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => setNow(new Date()), []);

  const label = now ? eventRelativeDay(event, now) : undefined;
  return label ? <StatusLabel tone="info">{label}</StatusLabel> : null;
}
