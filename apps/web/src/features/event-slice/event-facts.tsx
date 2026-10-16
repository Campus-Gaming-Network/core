import { StatusLabel } from "../../components/status-label";
import type { EventBrowseItemDTO } from "./contracts.js";
import { eventAudienceLabels, eventTypeLabels } from "./presentation";

/**
 * An event's type, audience, and cost as tags, as on the reference sheets: the
 * type is tinted blue, Free green, and the audience neutral. The format is
 * left to the location line ("Online", or the place then "+ online"). A fact
 * the event does not state is left out.
 */
export function EventFacts({
  event,
}: {
  event: Pick<EventBrowseItemDTO, "event_type" | "audience" | "cost">;
}) {
  return (
    <>
      {event.event_type ? (
        <StatusLabel tone="info">
          {eventTypeLabels[event.event_type]}
        </StatusLabel>
      ) : null}
      {event.audience ? (
        <StatusLabel>{eventAudienceLabels[event.audience]}</StatusLabel>
      ) : null}
      {event.cost === "free" ? (
        <StatusLabel tone="success">Free</StatusLabel>
      ) : null}
    </>
  );
}
