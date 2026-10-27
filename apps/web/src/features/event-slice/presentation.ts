import type { PageNotice } from "../../components/page-notice.js";
import { pageHead } from "../../components/public-page-head.js";
import type { EventBrowseItemDTO, EventDTO, EventRSVP } from "./contracts.js";

const eventsDescription =
  "Browse upcoming collegiate gaming events and filter them by game or school.";

export function eventsHead(publicOrigin?: string) {
  return pageHead(publicOrigin, {
    title: "Events",
    description: eventsDescription,
    path: "/events",
  });
}

/**
 * When an event happens, in its own time zone (never the server's or the
 * browser's, so SSR and hydration agree). The year shows only when the
 * event starts or ends outside the current year, a one-day event names its
 * date once, and the zone shows once unless it changes during the event (a
 * daylight-saving switch), e.g. "Aug 12, 1:45 PM – 5:45 PM MST" or
 * "Dec 31, 2027, 9:00 PM – Jan 1, 2028, 1:00 AM EST". `now` is the moment
 * the current year is read from.
 *
 * `startDate: false` leaves the start date out, for a row whose calendar tile
 * already shows it: "1:45 PM – 5:45 PM MST", or "9:00 PM – Jan 1, 1:00 AM EST"
 * for an event that ends on a later day.
 */
export function eventTimeRange(
  event: Pick<EventDTO, "starts_at" | "ends_at" | "timezone">,
  now: Date = new Date(),
  { startDate = true }: { startDate?: boolean } = {},
): string {
  const timeZone = event.timezone;
  const start = new Date(event.starts_at);
  const end = new Date(event.ends_at);
  const startDay = calendarDay(start, timeZone);
  const endDay = calendarDay(end, timeZone);
  const currentYear = calendarDay(now, timeZone).year;
  const showYear = startDay.year !== currentYear || endDay.year !== currentYear;

  const date = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(showYear ? { year: "numeric" } : {}),
    timeZone,
  });
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  });
  const startZone = zoneName(start, timeZone);
  const endZone = zoneName(end, timeZone);
  const startTime =
    startZone === endZone
      ? time.format(start)
      : `${time.format(start)} ${startZone}`;
  const endTime = `${time.format(end)} ${endZone}`;

  const startText = startDate
    ? `${date.format(start)}, ${startTime}`
    : startTime;
  if (
    startDay.year === endDay.year &&
    startDay.month === endDay.month &&
    startDay.day === endDay.day
  ) {
    return `${startText} – ${endTime}`;
  }
  return `${startText} – ${date.format(end)}, ${endTime}`;
}

/**
 * "Today" or "Tomorrow" for an event that has not started yet, judged by the
 * calendar day in the event's own time zone (the zone its times are shown in),
 * so "Today" always matches the date printed beside it. Days are compared as
 * calendar dates, never as 24-hour spans, so a daylight-saving day of 23 or 25
 * hours still counts as one day. A running or finished event gets no label
 * (the lifecycle tag already says so), and neither does anything further out.
 */
export function eventRelativeDay(
  event: Pick<EventDTO, "starts_at" | "timezone">,
  now: Date,
): "Today" | "Tomorrow" | undefined {
  const start = new Date(event.starts_at);
  if (now.getTime() >= start.getTime()) return undefined;
  const dayNumber = (value: Date) => {
    const { year, month, day } = calendarDay(value, event.timezone);
    return Date.UTC(Number(year), Number(month) - 1, Number(day)) / 86_400_000;
  };
  const days = dayNumber(start) - dayNumber(now);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return undefined;
}

export function eventWeekday(
  event: Pick<EventDTO, "starts_at" | "timezone">,
): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    timeZone: event.timezone,
  }).format(new Date(event.starts_at));
}

function calendarDay(
  value: Date,
  timeZone: string,
): { year: string; month: string; day: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    timeZone,
  }).formatToParts(value);
  const part = (type: string) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return { year: part("year"), month: part("month"), day: part("day") };
}

export function zoneName(value: Date, timeZone: string): string {
  return (
    new Intl.DateTimeFormat("en-US", { timeZoneName: "short", timeZone })
      .formatToParts(value)
      .find((part) => part.type === "timeZoneName")?.value ?? ""
  );
}

export function formatEventDate(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone,
  }).format(new Date(value));
}

/**
 * Where an event happens, for a list row: the place's name without its street
 * address, which the event page shows. A hybrid event adds "+ online". It is
 * undefined while an in-person or hybrid event has no place set.
 */
export function eventPlace(
  event: Pick<EventDTO, "format" | "location_name">,
): string | undefined {
  if (event.format === "online") {
    // The meeting link reaches only people going, so whether it is set says
    // nothing to everyone else.
    return "Online";
  }
  // A place not set yet is left out of the row rather than named "pending".
  if (event.format === "hybrid") {
    return event.location_name ? `${event.location_name} + online` : undefined;
  }
  return event.location_name || undefined;
}

/**
 * When a running event ends, in its own zone: "9:00 PM CDT", with the end
 * date added when the event ends on a later day than it started
 * ("Sep 5, 12:00 AM PDT").
 */
export function eventEndTime(
  event: Pick<EventDTO, "starts_at" | "ends_at" | "timezone">,
): string {
  const timeZone = event.timezone;
  const start = calendarDay(new Date(event.starts_at), timeZone);
  const end = new Date(event.ends_at);
  const endDay = calendarDay(end, timeZone);
  const sameDay =
    start.year === endDay.year &&
    start.month === endDay.month &&
    start.day === endDay.day;
  const time = new Intl.DateTimeFormat("en-US", {
    ...(sameDay ? {} : { month: "short", day: "numeric" }),
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(end);
  return `${time} ${zoneName(end, timeZone)}`;
}

export function eventLifecycleLabel(
  lifecycle: EventBrowseItemDTO["lifecycle"],
): string {
  const labels = {
    ended: "Ended",
    full: "Full",
    happening_now: "Happening now",
    upcoming: "Upcoming",
  } as const;
  return labels[lifecycle];
}

export function eventVisibilityLabel(
  visibility: EventDTO["visibility"],
): string {
  const labels = {
    private: "Private",
    public: "Public",
    unlisted: "Unlisted",
  } as const;
  return labels[visibility];
}

export function eventFormatLabel(format: EventDTO["format"]): string {
  const labels = {
    hybrid: "Hybrid",
    in_person: "In person",
    online: "Online",
  } as const;
  return labels[format];
}

export const eventAudienceLabels = {
  open: "Open to everyone",
  collegiate: "College students",
  campus: "Host campus only",
  members: "Members only",
} as const satisfies Record<NonNullable<EventDTO["audience"]>, string>;

// "Tournament" is a label only; it is not the separate Tournaments feature.
export const eventTypeLabels = {
  game_night: "Game night",
  lan: "LAN",
  tournament: "Tournament",
  watch_party: "Watch party",
  tryout: "Tryout",
  meeting: "Meeting",
  workshop: "Workshop",
  other: "Other",
} as const satisfies Record<NonNullable<EventDTO["event_type"]>, string>;

export function eventRSVPLabel(response: EventRSVP): string {
  const labels = { maybe: "Maybe", no: "Can't go", yes: "Going" } as const;
  return labels[response];
}

/** The tag tint for an RSVP answer, so Going and Maybe read apart at a glance. */
export function eventRSVPTone(
  response: EventRSVP,
): "success" | "warning" | "neutral" {
  const tones = { maybe: "warning", no: "neutral", yes: "success" } as const;
  return tones[response];
}

export function recurrenceRuleLabel(
  rule: NonNullable<EventDTO["recurrence_rule"]>,
): string {
  const labels = {
    biweekly: "Every two weeks",
    monthly: "Monthly",
    weekly: "Weekly",
  } as const;
  return labels[rule];
}

export function verificationLabel(level: string): string {
  const labels: Record<string, string> = {
    basic: "Community member",
    verified: "Verified student",
    staff_faculty: "Staff / faculty",
  };
  return labels[level] ?? "Community member";
}

export function roleIndicatorLabel(role: string): string {
  const labels: Record<string, string> = {
    school_admin: "School admin",
    site_admin: "Site admin",
    staff_faculty: "Staff / faculty",
  };
  return labels[role] ?? "Community role";
}

// Native event forms redirect failures to the event page, or to the browse
// page when the submitted slug was unusable.
const eventFailureNotices = {
  "cancel-failed": {
    message: "We could not cancel that event. Please try again.",
    severity: "danger",
  },
  "interest-failed": {
    message: "We could not update your interest. Please try again.",
    severity: "danger",
  },
  "report-failed": {
    message: "We could not submit that report. Please try again.",
    severity: "danger",
  },
  "rsvp-failed": {
    message: "We could not save your RSVP. Please try again.",
    severity: "danger",
  },
  "unlock-failed": {
    message: "That password did not unlock the event. Try again.",
    severity: "danger",
  },
} as const satisfies Record<string, PageNotice>;

export const eventBrowseNotices = {
  ...eventFailureNotices,
  cancelled: { message: "Event cancelled.", severity: "success" },
  failed: {
    message: "We could not update that event. Please try again.",
    severity: "danger",
  },
} as const satisfies Record<string, PageNotice>;

export const eventDetailNotices = {
  ...eventFailureNotices,
  created: { message: "Event created.", severity: "success" },
  "interest-added": { message: "Marked as interested.", severity: "success" },
  "organizer-joined": {
    message: "You're now a co-organizer of this event.",
    severity: "success",
  },
  "organizer-left": {
    message: "You're no longer a co-organizer of this event.",
    severity: "success",
  },
  "interest-removed": {
    message: "Removed from interested events.",
    severity: "success",
  },
  "report-submitted": {
    message: "Report submitted for review.",
    severity: "success",
  },
  "rsvp-updated": { message: "RSVP saved.", severity: "success" },
  unlocked: { message: "Event unlocked.", severity: "success" },
  updated: { message: "Event updated.", severity: "success" },
} as const satisfies Record<string, PageNotice>;

export type EventBrowseNotice = keyof typeof eventBrowseNotices;
export type EventDetailNotice = keyof typeof eventDetailNotices;

export function safeExternalEventUrl(
  value: string | undefined,
): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}
