import { Star, Users } from "lucide-react";

/** How many people are going and how many are interested, for an event row. */
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
        {going} going
      </span>
      <span>
        <Star aria-hidden="true" size={14} strokeWidth={1.75} />
        {interested} interested
      </span>
    </small>
  );
}
