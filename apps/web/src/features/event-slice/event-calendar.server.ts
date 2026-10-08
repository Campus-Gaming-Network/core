import { type ApiClient } from "../../server/api.server.js";
import {
  cookieHeaderValue,
  eventUnlockCookieName,
  sessionCookieName,
} from "../../server/cookies.server.js";
import { eventSlugInputSchema, type EventDTO } from "./contracts.js";
import { getEventDetailOperation } from "./event-operations.server.js";
import { eventAudienceLabels } from "./presentation.js";

type Dependencies = {
  api: ApiClient;
  publicOrigin: string;
  now?: () => Date;
  reportError?: (error: unknown) => void;
};

// Responses depend on the session and the per-event unlock cookie, so they are
// never shared-cacheable, and a calendar file is not something to index.
const responseHeaders = {
  "cache-control": "private, no-store",
  vary: "Cookie",
  "x-content-type-options": "nosniff",
  "x-robots-tag": "noindex, nofollow",
} as const;

// The Go API sends RSVP confirmations with this UID, so adding the file from
// the page and from the email updates one calendar entry instead of two.
const uidDomain = "campusgamingnetwork.com";
const maximumLineOctets = 75;

/**
 * Serves one event as an iCalendar file under the same access rules as the
 * event page: the detail read carries the viewer's session and any unlock
 * token, so a locked private event, a missing event, and a cancelled (soft
 * deleted) event all answer 404 with no body. Only fields the visible event
 * DTO already carries are written to the file.
 */
export async function eventCalendarResponse(
  request: Request,
  slug: string,
  { api, publicOrigin, now = () => new Date(), reportError }: Dependencies,
): Promise<Response> {
  const input = eventSlugInputSchema.safeParse({ slug });
  if (!input.success) return emptyResponse(404);

  const cookies = request.headers.get("cookie") ?? "";
  const sessionName = sessionCookieName();
  const sessionValue = cookieHeaderValue(cookies, sessionName);
  const unlockToken = cookieHeaderValue(
    cookies,
    eventUnlockCookieName(input.data.slug),
  );
  const detail = await getEventDetailOperation(input.data, {
    api,
    cookieHeader: sessionValue ? `${sessionName}=${sessionValue}` : "",
    unlockHeaders: unlockToken
      ? { "X-CGN-Event-Unlock": unlockToken }
      : undefined,
    reportError,
  });

  if (detail.status === "error") return emptyResponse(503);
  if (detail.status === "not_found" || "locked" in detail.event) {
    return emptyResponse(404);
  }

  const event = detail.event;
  const calendar = eventICS(
    event,
    `${publicOrigin}/events/${encodeURIComponent(event.slug)}`,
    now(),
  );
  const filename = `${event.slug.replace(/[^A-Za-z0-9_-]/g, "_")}.ics`;

  return new Response(request.method === "HEAD" ? null : calendar, {
    status: 200,
    headers: {
      ...responseHeaders,
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": `inline; filename="${filename}"`,
    },
  });
}

/**
 * Builds a single-event VCALENDAR (RFC 5545). Times are the event's UTC
 * instants. Recurring events are not expanded: each occurrence is its own
 * event with its own UID.
 */
export function eventICS(event: EventDTO, eventURL: string, now: Date): string {
  const description = [
    event.description,
    ...(event.audience
      ? [`Who it's for: ${eventAudienceLabels[event.audience]}`]
      : []),
    `View event: ${eventURL}`,
  ]
    .join("\n\n")
    .trim();
  const location = icsLocation(event);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Campus Gaming Network//CGN//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${escapeICSText(`${event.id}@${uidDomain}`)}`,
    `DTSTAMP:${icsTime(now)}`,
    `DTSTART:${icsTime(new Date(event.starts_at))}`,
    `DTEND:${icsTime(new Date(event.ends_at))}`,
    `SUMMARY:${escapeICSText(event.title)}`,
    `DESCRIPTION:${escapeICSText(description)}`,
    ...(location ? [`LOCATION:${escapeICSText(location)}`] : []),
    `URL:${eventURL}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  return `${lines.map(foldICSLine).join("\r\n")}\r\n`;
}

function emptyResponse(status: number): Response {
  return new Response(null, {
    status,
    headers: responseHeaders,
  });
}

function icsLocation(
  event: Pick<EventDTO, "format" | "location_name" | "address" | "online_url">,
): string {
  const online = event.online_url ? `Online: ${event.online_url}` : "";
  const place = [event.location_name, event.address]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(", ");

  if (event.format === "online") return online || "Online";
  if (event.format === "hybrid") {
    return [place, online].filter(Boolean).join(" + ") || "Hybrid";
  }
  return place;
}

function icsTime(value: Date): string {
  return value
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/[-:]/g, "");
}

// RFC 5545 section 3.3.11. Newlines inside a value would otherwise start a new
// content line, so they become the \n escape, and any other control character
// is dropped rather than written into the file.
function escapeICSText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/\p{Cc}/gu, (char) => (char === "\n" || char === "\t" ? char : ""))
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

// RFC 5545 section 3.1. Content lines longer than 75 octets continue on a new
// line that starts with one space. Lines break between code points so a
// multi-byte character is never split.
function foldICSLine(line: string): string {
  const encoder = new TextEncoder();
  const folded: string[] = [];
  let current = "";
  let octets = 0;
  let limit = maximumLineOctets;

  for (const char of line) {
    const size = encoder.encode(char).length;
    if (octets + size > limit) {
      folded.push(current);
      current = "";
      octets = 0;
      limit = maximumLineOctets - 1;
    }
    current += char;
    octets += size;
  }
  folded.push(current);

  return folded.join("\r\n ");
}
