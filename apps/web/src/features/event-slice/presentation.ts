import type {
  EventBrowseItemDTO,
  EventDTO,
  EventNotice,
  EventRSVP
} from "./contracts.js";

export const eventsDescription =
  "Browse upcoming collegiate gaming events and filter them by game or school.";

const siteName = "Campus Gaming Network";

export function eventsHead(publicOrigin = "http://localhost:3000") {
  const title = `Events | ${siteName}`;
  return {
    meta: [
      { title },
      { name: "description", content: eventsDescription },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: siteName },
      { property: "og:title", content: title },
      { property: "og:description", content: eventsDescription },
      { property: "og:url", content: `${publicOrigin}/events` },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: title },
      { name: "twitter:description", content: eventsDescription }
    ]
  };
}

export function eventTimeRange(
  event: Pick<EventDTO, "starts_at" | "ends_at" | "timezone">
): string {
  const formatter = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: event.timezone
  });

  return `${formatter.format(new Date(event.starts_at))} – ${formatter.format(
    new Date(event.ends_at)
  )}`;
}

export function formatEventDate(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone
  }).format(new Date(value));
}

export function eventLocation(
  event: Pick<
    EventDTO,
    "format" | "location_name" | "address" | "online_url"
  >
): string {
  if (event.format === "online") {
    return event.online_url ? "Online" : "Online details pending";
  }

  const inPersonLocation = [event.location_name, event.address]
    .filter(Boolean)
    .join(" · ");

  if (event.format === "hybrid") {
    return inPersonLocation
      ? `${inPersonLocation} + online`
      : "Hybrid details pending";
  }

  return inPersonLocation || "Location pending";
}

export function eventLifecycleLabel(
  lifecycle: EventBrowseItemDTO["lifecycle"]
): string {
  const labels = {
    ended: "Ended",
    full: "Full",
    happening_now: "Happening now",
    upcoming: "Upcoming"
  } as const;
  return labels[lifecycle];
}

export function eventVisibilityLabel(
  visibility: EventDTO["visibility"]
): string {
  const labels = {
    private: "Private",
    public: "Public",
    unlisted: "Unlisted"
  } as const;
  return labels[visibility];
}

export function eventFormatLabel(format: EventDTO["format"]): string {
  const labels = {
    hybrid: "Hybrid",
    in_person: "In person",
    online: "Online"
  } as const;
  return labels[format];
}

export function eventRSVPLabel(response: EventRSVP): string {
  const labels = { maybe: "Maybe", no: "No", yes: "Yes" } as const;
  return labels[response];
}

export function recurrenceRuleLabel(
  rule: NonNullable<EventDTO["recurrence_rule"]>
): string {
  const labels = {
    biweekly: "Every two weeks",
    monthly: "Monthly",
    weekly: "Weekly"
  } as const;
  return labels[rule];
}

export function verificationLabel(level: string): string {
  const labels: Record<string, string> = {
    basic: "Community member",
    verified: "Verified student",
    staff_faculty: "Staff / faculty"
  };
  return labels[level] ?? "Community member";
}

export function roleIndicatorLabel(role: string): string {
  const labels: Record<string, string> = {
    school_admin: "School admin",
    staff_faculty: "Staff / faculty"
  };
  return labels[role] ?? "Community role";
}

export function eventNoticeMessage(notice: EventNotice): string {
  const notices: Record<EventNotice, string> = {
    "cancel-failed": "We could not cancel that event. Please try again.",
    cancelled: "Event cancelled.",
    created: "Event created.",
    "delete-failed": "We could not cancel that event. Please try again.",
    deleted: "Event cancelled.",
    failed: "We could not update that event. Please try again.",
    "interest-added": "Marked as interested.",
    "interest-failed": "We could not update your interest. Please try again.",
    "interest-removed": "Removed from interested events.",
    "report-failed": "We could not submit that report. Please try again.",
    "report-submitted": "Report submitted for review.",
    "rsvp-failed": "We could not save your RSVP. Please try again.",
    "rsvp-updated": "RSVP saved.",
    "unlock-failed": "That password did not unlock the event. Try again.",
    unlocked: "Event unlocked.",
    updated: "Event updated."
  };
  return notices[notice];
}

export function isFailureNotice(notice: EventNotice): boolean {
  return notice === "failed" || notice.endsWith("-failed");
}

export function safeExternalEventUrl(
  value: string | undefined
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
