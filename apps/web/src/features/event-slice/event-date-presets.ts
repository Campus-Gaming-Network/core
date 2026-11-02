import { instantToLocalDateTime } from "./event-time.js";

export type EventDatePreset = {
  label: string;
  from: string;
  to: string;
};

/**
 * The zone that decides "today" when the viewer is signed out or their
 * profile zone is unreadable. It matches the event form's default.
 */
export const fallbackPresetTimeZone = "America/Los_Angeles";

/** The YYYY-MM-DD calendar day of `now` in `timeZone`. */
export function localToday(now: Date, timeZone: string): string {
  return (
    instantToLocalDateTime(now.toISOString(), timeZone).slice(0, 10) ||
    instantToLocalDateTime(now.toISOString(), fallbackPresetTimeZone).slice(
      0,
      10,
    )
  );
}

/**
 * The date shortcuts over the events directory, as inclusive from and to
 * days counted from `today`. The weekend runs Friday to Sunday because campus
 * game nights and LANs usually start on Friday evening; from Friday on it
 * starts today instead of skipping to the next one.
 */
export function eventDatePresets(today: string): EventDatePreset[] {
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  const daysToFriday = weekday === 0 ? -2 : 5 - weekday;
  const daysToSunday = weekday === 0 ? 0 : 7 - weekday;
  return [
    {
      label: "This weekend",
      from: addDays(today, Math.max(daysToFriday, 0)),
      to: addDays(today, daysToSunday),
    },
    { label: "Next 7 days", from: today, to: addDays(today, 6) },
    { label: "Next 30 days", from: today, to: addDays(today, 29) },
  ];
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
