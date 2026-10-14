import { Link } from "@tanstack/react-router";
import { StatusLabel } from "../../components/status-label";
import { CalendarDate } from "../../components/calendar-date";
import {
  DirectoryRow,
  directoryRowClassName,
} from "../../components/directory-row";
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
      className={directoryRowClassName}
      to="/events/$slug"
      params={{ slug: event.slug }}
    >
      <DirectoryRow
        action="View event"
        counts={
          <EventCounts
            going={event.rsvp_yes_count}
            interested={event.interest_count}
          />
        }
        detail={eventTimeRange(event)}
        identity={
          <CalendarDate
            decorative
            startsAt={event.starts_at}
            timezone={event.timezone}
          />
        }
        meta={[event.host_school.name, eventLocation(event)]}
        name={event.title}
        status={
          event.lifecycle !== "upcoming" ? (
            <StatusLabel status={event.lifecycle}>
              {eventLifecycleLabel(event.lifecycle)}
            </StatusLabel>
          ) : undefined
        }
        facts={<EventFacts event={event} />}
        tags={event.games.map((game) => game.name)}
      />
    </Link>
  );
}
