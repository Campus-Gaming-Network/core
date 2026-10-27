import { Star, Users } from "lucide-react";
import type * as z from "zod";
import type { eventFillDtoSchema } from "../features/event-slice/contracts.js";

const count = new Intl.NumberFormat("en-US");

type EventCountsEvent = z.output<typeof eventFillDtoSchema> & {
  rsvp_yes_count: number;
  interest_count: number;
};

/**
 * How many people are going, against the capacity when there is one, for an
 * event row. A tournament counts its registered entries against its cap
 * instead, as its page does. "0 interested" says nothing useful, so it is
 * left out.
 */
export function EventCounts({ event }: { event: EventCountsEvent }) {
  const entries = event.tournament_entries;
  const filled = entries
    ? entries.entrant_cap
      ? `${count.format(entries.entry_count)} of ${count.format(entries.entrant_cap)} registered`
      : `${count.format(entries.entry_count)} registered`
    : event.capacity
      ? `${count.format(event.rsvp_yes_count)} of ${count.format(event.capacity)} going`
      : `${count.format(event.rsvp_yes_count)} going`;
  return (
    <small className="event-counts">
      <span>
        <Users aria-hidden="true" size={14} strokeWidth={1.75} />
        {filled}
      </span>
      {event.interest_count > 0 ? (
        <span>
          <Star aria-hidden="true" size={14} strokeWidth={1.75} />
          {count.format(event.interest_count)} interested
        </span>
      ) : null}
    </small>
  );
}
