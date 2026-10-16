import { Cog, Presentation, Trophy, type LucideIcon } from "lucide-react";
import { StatusLabel } from "../../components/status-label";
import type { EventBrowseItemDTO } from "./contracts.js";
import { eventAudienceLabels, eventTypeLabels } from "./presentation";

type EventType = NonNullable<EventBrowseItemDTO["event_type"]>;

// The types whose tag carries an icon before its word. The word always
// carries the meaning; the icon only helps the eye find it.
const eventTypeIcons: Partial<Record<EventType, LucideIcon>> = {
  meeting: Presentation,
  tournament: Trophy,
  workshop: Cog,
};

/** An event's type as a tag, with its icon when the type has one. */
export function EventTypeTag({
  tone,
  type,
}: {
  tone?: "info";
  type: EventType;
}) {
  const Icon = eventTypeIcons[type];
  return (
    <StatusLabel tone={tone}>
      {Icon ? <Icon aria-hidden="true" size={12} strokeWidth={2.25} /> : null}
      {eventTypeLabels[type]}
    </StatusLabel>
  );
}

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
        <EventTypeTag tone="info" type={event.event_type} />
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
