import type { EventDTO } from "../event-slice/contracts.js";
import {
  eventAudienceLabels,
  eventFormatLabel,
  eventTypeLabels,
  eventVisibilityLabel,
  zoneName,
} from "../event-slice/presentation.js";
import type { EventActivityChange, EventActivityEntry } from "./contracts.js";

/** One log entry in words. */
export type EventActivityLine = {
  summary: string;
  /** One line per changed field, empty for anything but an edit. */
  details: string[];
  /** Who made the change, for an editor's view only. */
  author?: string;
  /** When, in the event's own time zone. */
  when: string;
};

const actionSummaries = {
  "event.created": "Event created",
  "event.updated": "Details changed",
  "event.cancelled": "Event cancelled",
  "event.organizer_joined": "A co-organizer joined",
  "event.organizer_removed": "A co-organizer was removed",
  "event.organizer_left": "A co-organizer stepped down",
  "event.creator_transferred": "The creator role was handed to a co-organizer",
} as const satisfies Record<EventActivityEntry["action"], string>;

/** Fields the log records as changed only, in words. */
const changedOnlyLines: Record<string, string> = {
  online_url: "Online link changed",
  payment_note: "Payment note changed",
  payment_url: "Payment link changed",
  description: "Description changed",
  private_password: "Password changed",
};

const costLabels: Record<string, string> = {
  free: "Free",
  paid: "Paid",
  unspecified: "Not stated",
};

/**
 * An entry as the log shows it. An entry carries `actor` only in an editor's
 * view, where a null actor is an account deleted since.
 */
export function eventActivityLine(
  entry: EventActivityEntry,
  timeZone: EventDTO["timezone"],
): EventActivityLine {
  return {
    summary: actionSummaries[entry.action],
    details: entry.changes.flatMap((change) => changeLines(change, timeZone)),
    ...(entry.actor === undefined
      ? {}
      : { author: entry.actor?.name ?? "Deleted account" }),
    when: formatInstant(entry.occurred_at, timeZone),
  };
}

function changeLines(change: EventActivityChange, timeZone: string): string[] {
  const changedOnly = changedOnlyLines[change.field];
  if (changedOnly) return [changedOnly];
  const { before, after } = change;
  switch (change.field) {
    case "title":
      return [`Title changed from “${text(before)}” to “${text(after)}”`];
    case "starts_at":
      return [
        `Start moved from ${time(before, timeZone)} to ${time(after, timeZone)}`,
      ];
    case "ends_at":
      return [
        `End moved from ${time(before, timeZone)} to ${time(after, timeZone)}`,
      ];
    case "timezone":
      return [fromTo("Time zone", text(before), text(after))];
    case "format":
      return [
        fromTo("Format", label(before, formatLabel), label(after, formatLabel)),
      ];
    case "location_name":
      return [fromTo("Location", text(before), text(after))];
    case "address":
      return [fromTo("Address", text(before), text(after))];
    case "cost":
      return [
        fromTo("Cost", label(before, costLabels), label(after, costLabels)),
      ];
    case "host_team":
      return [fromTo("Host team", named(before), named(after))];
    case "host_club":
      return [fromTo("Host club", named(before), named(after))];
    case "host_school":
      return [fromTo("Host school", named(before), named(after))];
    case "visibility":
      return [
        fromTo(
          "Visibility",
          label(before, visibilityLabel),
          label(after, visibilityLabel),
        ),
      ];
    case "audience":
      return [
        fromTo(
          "Audience",
          label(before, eventAudienceLabels),
          label(after, eventAudienceLabels),
        ),
      ];
    case "event_type":
      return [
        fromTo(
          "Type",
          label(before, eventTypeLabels),
          label(after, eventTypeLabels),
        ),
      ];
    case "capacity":
      return [fromTo("Capacity", capacity(before), capacity(after))];
    case "games":
      return [
        ...gameLine("Games removed", before),
        ...gameLine("Games added", after),
      ];
    default:
      // A field added to the API after this page shows without its values.
      return [`${change.field.replaceAll("_", " ")} changed`];
  }
}

function fromTo(subject: string, before: string, after: string): string {
  return `${subject} changed from ${before} to ${after}`;
}

function text(value: unknown): string {
  return typeof value === "string" && value !== "" ? value : "none";
}

function named(value: unknown): string {
  return typeof value === "object" &&
    value !== null &&
    "name" in value &&
    typeof value.name === "string"
    ? value.name
    : "none";
}

function label(value: unknown, labels: Record<string, string>): string {
  return typeof value === "string" ? (labels[value] ?? value) : "none";
}

function capacity(value: unknown): string {
  return typeof value === "number" ? String(value) : "no limit";
}

function gameLine(subject: string, value: unknown): string[] {
  const names = Array.isArray(value)
    ? value.map((game) => named(game)).filter((name) => name !== "none")
    : [];
  return names.length > 0 ? [`${subject}: ${names.join(", ")}`] : [];
}

function time(value: unknown, timeZone: string): string {
  return typeof value === "string" ? formatInstant(value, timeZone) : "none";
}

const formatLabel: Record<string, string> = {
  hybrid: eventFormatLabel("hybrid"),
  in_person: eventFormatLabel("in_person"),
  online: eventFormatLabel("online"),
};

const visibilityLabel: Record<string, string> = {
  private: eventVisibilityLabel("private"),
  public: eventVisibilityLabel("public"),
  unlisted: eventVisibilityLabel("unlisted"),
};

/** A moment in the event's zone: "Mar 1, 2030, 7:00 PM UTC". */
function formatInstant(value: string, timeZone: string): string {
  const instant = new Date(value);
  const local = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(instant);
  return `${local} ${zoneName(instant, timeZone)}`.trim();
}
