import { Star, Users } from "lucide-react";

const count = new Intl.NumberFormat("en-US");

/**
 * How many people are going and, when anyone is, how many are interested, for
 * an event row. "0 interested" says nothing useful, so it is left out.
 */
export function EventCounts({
  going,
  interested,
}: {
  going: number;
  interested: number;
}) {
  return (
    <small className="event-counts">
      <span>
        <Users aria-hidden="true" size={14} strokeWidth={1.75} />
        {count.format(going)} going
      </span>
      {interested > 0 ? (
        <span>
          <Star aria-hidden="true" size={14} strokeWidth={1.75} />
          {count.format(interested)} interested
        </span>
      ) : null}
    </small>
  );
}
