import {
  Cog,
  Globe,
  GraduationCap,
  Presentation,
  School,
  Shield,
  Trophy,
  type LucideIcon,
} from "lucide-react";
import { StatusLabel } from "../../components/status-label.js";
import type { EventBrowseItemDTO } from "./contracts.js";
import { eventAudienceLabels, eventTypeLabels } from "./presentation.js";

type EventType = NonNullable<EventBrowseItemDTO["event_type"]>;
type EventAudience = NonNullable<EventBrowseItemDTO["audience"]>;

// The types whose tag carries an icon before its word. The word always
// carries the meaning; the icon only helps the eye find it.
const eventTypeIcons: Partial<Record<EventType, LucideIcon>> = {
  meeting: Presentation,
  tournament: Trophy,
  workshop: Cog,
};

// Every audience has an icon, so the eye can tell who may come at a glance.
const eventAudienceIcons: Record<EventAudience, LucideIcon> = {
  open: Globe,
  collegiate: GraduationCap,
  campus: School,
  members: Shield,
};

/**
 * An event's type as a tag, with its icon when the type has one. "Other" says
 * nothing about the event, so it shows no tag.
 */
export function EventTypeTag({
  tone,
  type,
}: {
  tone?: "info";
  type: EventType;
}) {
  if (type === "other") return null;
  const Icon = eventTypeIcons[type];
  return (
    <StatusLabel tone={tone}>
      {Icon ? <Icon aria-hidden="true" size={12} strokeWidth={2.25} /> : null}
      {eventTypeLabels[type]}
    </StatusLabel>
  );
}

/** An event's audience as a neutral tag with its icon. */
function EventAudienceTag({ audience }: { audience: EventAudience }) {
  const Icon = eventAudienceIcons[audience];
  return (
    <StatusLabel>
      <Icon aria-hidden="true" size={12} strokeWidth={2.25} />
      {eventAudienceLabels[audience]}
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
      {event.audience ? <EventAudienceTag audience={event.audience} /> : null}
      {event.cost === "free" ? (
        <StatusLabel tone="success">Free</StatusLabel>
      ) : null}
    </>
  );
}
