import { Link } from "@tanstack/react-router";
import { StatusLabel } from "../../components/status-label";
import { ArrowRight } from "lucide-react";
import { CalendarDate } from "../../components/calendar-date";
import { EventCounts } from "../../components/event-counts";
import type { EventBrowseItemDTO } from "./contracts.js";
import { EventFacts } from "./event-facts";
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
      <CalendarDate
        decorative
        startsAt={event.starts_at}
        timezone={event.timezone}
      />
      <span className="event-card-copy">
        {event.lifecycle !== "upcoming" ? (
          <StatusLabel status={event.lifecycle}>
            {eventLifecycleLabel(event.lifecycle)}
          </StatusLabel>
        ) : null}
        <span className="event-card-heading">
          <strong>{event.title}</strong>
        </span>
        <small>{eventTimeRange(event)}</small>
        <small>
          {event.host_school.name} ·{" "}
          {event.games.map((game) => game.name).join(", ")}
        </small>
        <small>{eventLocation(event)}</small>
        <span className="event-pill-list event-pill-list--compact">
          <EventFacts event={event} />
        </span>
        <EventCounts
          going={event.rsvp_yes_count}
          interested={event.interest_count}
        />
      </span>
      <span className="event-card-action with-arrow">
        View event
        <ArrowRight aria-hidden="true" size={14} strokeWidth={2.25} />
      </span>
    </Link>
  );
}
