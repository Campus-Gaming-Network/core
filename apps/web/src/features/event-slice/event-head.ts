import {
  absoluteUrl,
  pageHead,
  previewText,
  siteName,
} from "../../components/public-page-head.js";
import { eventWhen, previewImageUrl } from "../seo-slice/preview.js";
import type { EventDTO, EventDetailDTO } from "./contracts.js";

/** Shown for an event whose details must not leave the page. */
export const privateEventPreview = {
  title: "Private event",
  description: "This event is private. Enter the password to view it.",
} as const;

/** Shown for an event meant for one campus or one group. */
export const restrictedEventPreview = {
  title: "Event",
  description: `An event on ${siteName} for a specific campus or group. Open the link to see whether it is for you.`,
} as const;

type LinkTag = Record<string, string>;

/**
 * The head of an event page.
 *
 * Only a public event open to everyone, or to students at any school, shows
 * its title, description, and details here, and only that event gets
 * structured data. An unlisted event keeps a normal link preview, because its
 * host shared the link on purpose, but stays out of search. A private event
 * and an event for one campus or group get a generic card and stay out of
 * search: a link preview is public to everyone who sees the link, and the
 * chat that unfurls it has no way to check who is allowed in.
 *
 * `extraLinks` are the route's own links, such as its stylesheet.
 */
export function eventDetailHead(
  loaderData:
    | { event: EventDetailDTO; publicOrigin: string | undefined }
    | undefined,
  extraLinks: LinkTag[] = [],
) {
  const event = loaderData?.event;
  const publicOrigin = loaderData?.publicOrigin;

  if (!event || !isFullEvent(event) || event.visibility === "private") {
    const head = withLinks(
      pageHead(publicOrigin, {
        ...privateEventPreview,
        path: event ? eventPath(event.slug) : "/events",
        noIndex: true,
      }),
      extraLinks,
    );
    if (!event || !isFullEvent(event)) return head;
    // The API sends a private event in full only to someone allowed to see
    // it; everyone else, a link preview bot included, gets it locked. So the
    // viewer's tab can name it, while the preview tags stay generic.
    return {
      ...head,
      meta: head.meta.map((tag) =>
        "title" in tag ? { title: `${event.title} | ${siteName}` } : tag,
      ),
    };
  }

  if (isRestrictedAudience(event)) {
    return withLinks(
      pageHead(publicOrigin, {
        ...restrictedEventPreview,
        path: eventPath(event.slug),
        noIndex: true,
      }),
      extraLinks,
    );
  }

  const path = eventPath(event.slug);
  const indexable = event.visibility === "public";
  const logo = previewImageUrl(publicOrigin, event.host_school.logo_url);
  return withLinks(
    pageHead(publicOrigin, {
      title: event.title,
      description: eventPreviewDescription(event),
      path,
      breadcrumbs: [{ name: "Events", path: "/events" }],
      ...(logo
        ? { image: logo, imageAlt: `${event.host_school.name} logo` }
        : {}),
      noIndex: !indexable,
      ...(indexable ? { jsonLd: eventJsonLd(event, publicOrigin) } : {}),
    }),
    extraLinks,
  );
}

/**
 * When and where first, then the host's own words, cut to a chat preview.
 * The street address stays on the page and in structured data.
 */
export function eventPreviewDescription(event: EventDTO): string {
  const place = {
    online: "Online",
    in_person: event.location_name || event.host_school.name,
    hybrid: `${event.location_name || event.host_school.name} and online`,
  }[event.format];
  const when = eventWhen(event.starts_at, event.ends_at, event.timezone);
  const about =
    event.description.trim() ||
    `A campus gaming event hosted by ${event.host_school.name}.`;
  return previewText(`${when} at ${place}. ${about}`);
}

/**
 * schema.org Event for a public event. The organizer is the host school, not a
 * person, and an online event's meeting link is left out: the page may show it
 * only to people who RSVP.
 */
function eventJsonLd(
  event: EventDTO,
  publicOrigin: string | undefined,
): Record<string, unknown> {
  const url = absoluteUrl(publicOrigin, eventPath(event.slug));
  const physical = {
    "@type": "Place",
    name: event.location_name || event.host_school.name,
    ...(event.address ? { address: event.address } : {}),
  };
  const virtual = { "@type": "VirtualLocation", url };
  const attendance = {
    online: "OnlineEventAttendanceMode",
    in_person: "OfflineEventAttendanceMode",
    hybrid: "MixedEventAttendanceMode",
  } as const;

  return {
    "@context": "https://schema.org",
    "@type": "Event",
    name: event.title,
    ...(event.description
      ? { description: previewText(event.description, 500) }
      : {}),
    url,
    startDate: isoWithOffset(event.starts_at, event.timezone),
    endDate: isoWithOffset(event.ends_at, event.timezone),
    eventStatus: "https://schema.org/EventScheduled",
    eventAttendanceMode: `https://schema.org/${attendance[event.format]}`,
    location:
      event.format === "online"
        ? virtual
        : event.format === "hybrid"
          ? [physical, virtual]
          : physical,
    organizer: {
      "@type": "CollegeOrUniversity",
      name: event.host_school.name,
      url: absoluteUrl(
        publicOrigin,
        `/schools/${encodeURIComponent(event.host_school.slug)}`,
      ),
    },
    image: [
      previewImageUrl(publicOrigin, event.host_school.logo_url) ??
        absoluteUrl(publicOrigin, "/og-default.png"),
    ],
    ...(event.cost === "free" ? { isAccessibleForFree: true } : {}),
  };
}

/**
 * An instant written in the event's own time zone, with its UTC offset, such as
 * 2031-05-01T19:00:00-07:00. Search results show the time where the event is.
 */
export function isoWithOffset(instant: string, timeZone: string): string {
  const parts = new Map(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZoneName: "longOffset",
    })
      .formatToParts(new Date(instant))
      .map((part) => [part.type, part.value]),
  );
  const offset = (parts.get("timeZoneName") ?? "GMT").replace("GMT", "");

  return `${parts.get("year")}-${parts.get("month")}-${parts.get("day")}T${parts.get("hour")}:${parts.get("minute")}:${parts.get("second")}${offset || "+00:00"}`;
}

function eventPath(slug: string): `/${string}` {
  return `/events/${encodeURIComponent(slug)}`;
}

function isFullEvent(event: EventDetailDTO): event is EventDTO {
  return !("locked" in event);
}

function isRestrictedAudience(event: EventDTO): boolean {
  return event.audience === "campus" || event.audience === "members";
}

function withLinks<T extends { links: LinkTag[] }>(
  head: T,
  extraLinks: LinkTag[],
): T {
  return { ...head, links: [...head.links, ...extraLinks] };
}
