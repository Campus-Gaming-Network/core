import { Link } from "@tanstack/react-router";
import type { EventBrowseItemDTO } from "./contracts.js";
import { EventBanner } from "./event-banner";
import {
  eventLifecycleLabel,
  eventLocation,
  eventTimeRange,
} from "./presentation";

/** One public event in a list, linking to its page. */
export function EventCard({ event }: { event: EventBrowseItemDTO }) {
  return (
    <Link
      className="card card--default list-item event-list-item"
      to="/events/$slug"
      params={{ slug: event.slug }}
    >
      <EventBanner event={event} />
      <span className="event-card-heading">
        <strong>{event.title}</strong>
        <small>{eventLifecycleLabel(event.lifecycle)}</small>
      </span>
      <small>{eventTimeRange(event)}</small>
      <small>
        {event.host_school.name} ·{" "}
        {event.games.map((game) => game.name).join(", ")}
      </small>
      <small>{eventLocation(event)}</small>
    </Link>
  );
}
