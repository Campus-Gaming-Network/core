import { useEventRelativeDay } from "../features/event-slice/event-relative-day";
import { eventWeekday } from "../features/event-slice/presentation";

/**
 * A calendar-page tile for an event's start date: the month on a colored band
 * above a large day number and the weekday, in the event's own time zone. Pass
 * `decorative` where the full date is already written out beside it (the
 * event page header), so assistive technology does not read it twice. With
 * `relativeDay`, an event starting today or tomorrow shows "Today" or
 * "Tomorrow" in place of the weekday, highlighted, from the server HTML on.
 * `inProgress` marks an event that is happening now: "Now", in green, from
 * the first render, since the API says so.
 */
export function CalendarDate({
  decorative = false,
  inProgress = false,
  relativeDay = false,
  size = "default",
  startsAt,
  timezone,
}: {
  decorative?: boolean;
  inProgress?: boolean;
  relativeDay?: boolean;
  size?: "default" | "large";
  startsAt: string;
  timezone: string;
}) {
  const soon = useEventRelativeDay({ starts_at: startsAt, timezone });
  const relative = inProgress ? "Now" : relativeDay ? soon : undefined;
  const start = new Date(startsAt);
  const month = new Intl.DateTimeFormat("en-US", {
    month: "short",
    timeZone: timezone,
  }).format(start);
  const weekday = eventWeekday({ starts_at: startsAt, timezone });
  const day = new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    timeZone: timezone,
  }).format(start);

  return (
    <time
      aria-hidden={decorative || undefined}
      className={[
        "calendar-date",
        size === "large" ? "calendar-date--large" : "",
        relative ? "calendar-date--soon" : "",
        inProgress ? "calendar-date--now" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      dateTime={startsAt}
    >
      <span className="calendar-date__month">{month}</span>
      <span className="calendar-date__day">{day}</span>
      <span className="calendar-date__weekday">{relative ?? weekday}</span>
    </time>
  );
}
