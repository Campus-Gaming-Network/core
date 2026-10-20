import { absoluteUrl } from "../../components/public-page-head.js";

/**
 * A human date and time range in the event's own time zone, such as
 * "Fri, May 1, 7:00 to 10:00 PM PDT". An event that ends on another day names
 * both days.
 */
export function eventWhen(
  startsAt: string,
  endsAt: string,
  timeZone: string,
): string {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  });
  const zone =
    new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" })
      .formatToParts(start)
      .find((part) => part.type === "timeZoneName")?.value ?? timeZone;

  const sameDay = day.format(start) === day.format(end);
  return sameDay
    ? `${day.format(start)}, ${time.format(start)} to ${time.format(end)} ${zone}`
    : `${day.format(start)}, ${time.format(start)} to ${day.format(end)}, ${time.format(end)} ${zone}`;
}

/**
 * An image address a chat or search crawler can fetch: http or https, with a
 * site-relative path resolved against the site's own origin. Anything else is
 * dropped so a preview falls back to the default image.
 */
export function previewImageUrl(
  publicOrigin: string | undefined,
  value: string | undefined,
): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(
      value.startsWith("/") ? absoluteUrl(publicOrigin, value) : value,
    );
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

/** The cover image of the first game that has one, as an absolute address. */
export function firstGameCoverUrl(
  publicOrigin: string | undefined,
  games: ReadonlyArray<{ slug: string; has_cover?: boolean }>,
): string | undefined {
  const game = games.find((candidate) => candidate.has_cover);
  return game
    ? absoluteUrl(
        publicOrigin,
        `/api/games/${encodeURIComponent(game.slug)}/cover`,
      )
    : undefined;
}
