/**
 * A calendar-page tile for an event's start date: the month on a colored band
 * above a large day number, in the event's own time zone. Pass `decorative`
 * where the full date is already written out beside it (event rows), so
 * assistive technology does not read it twice.
 */
export function CalendarDate({
  decorative = false,
  size = "default",
  startsAt,
  timezone,
}: {
  decorative?: boolean;
  size?: "default" | "large";
  startsAt: string;
  timezone: string;
}) {
  const start = new Date(startsAt);
  const month = new Intl.DateTimeFormat("en-US", {
    month: "short",
    timeZone: timezone,
  }).format(start);
  const day = new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    timeZone: timezone,
  }).format(start);

  return (
    <time
      aria-hidden={decorative || undefined}
      className={
        size === "large"
          ? "calendar-date calendar-date--large"
          : "calendar-date"
      }
      dateTime={startsAt}
    >
      <span className="calendar-date__month">{month}</span>
      <span className="calendar-date__day">{day}</span>
    </time>
  );
}
