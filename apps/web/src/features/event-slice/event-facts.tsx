import { Gamepad2, MapPin, Ticket, Users } from "lucide-react";
import type { ReactNode } from "react";
import type { EventBrowseItemDTO } from "./contracts.js";
import {
  eventAudienceLabels,
  eventFormatLabel,
  eventTypeLabels,
} from "./presentation";

/**
 * An event's format, type, audience, and cost as labels. Each kind has its own
 * icon and color (components.css) so they can be told apart at a glance, on a
 * card and above an event's title. A fact the event does not state is left out.
 */
export function EventFacts({
  event,
}: {
  event: Pick<
    EventBrowseItemDTO,
    "format" | "event_type" | "audience" | "cost"
  >;
}) {
  const facts: { kind: string; icon: ReactNode; label: string }[] = [
    {
      kind: "format",
      icon: <MapPin aria-hidden="true" size={12} strokeWidth={2.5} />,
      label: eventFormatLabel(event.format),
    },
    ...(event.event_type
      ? [
          {
            kind: "type",
            icon: <Gamepad2 aria-hidden="true" size={12} strokeWidth={2.5} />,
            label: eventTypeLabels[event.event_type],
          },
        ]
      : []),
    ...(event.audience
      ? [
          {
            kind: "audience",
            icon: <Users aria-hidden="true" size={12} strokeWidth={2.5} />,
            label: eventAudienceLabels[event.audience],
          },
        ]
      : []),
    ...(event.cost === "free"
      ? [
          {
            kind: "cost",
            icon: <Ticket aria-hidden="true" size={12} strokeWidth={2.5} />,
            label: "Free",
          },
        ]
      : []),
  ];

  return facts.map((fact) => (
    <span className={`event-pill event-pill--${fact.kind}`} key={fact.kind}>
      {fact.icon}
      {fact.label}
    </span>
  ));
}
