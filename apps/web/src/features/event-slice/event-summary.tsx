import {
  CalendarDays,
  CalendarPlus,
  ExternalLink,
  Globe,
  MapPin,
  Ticket,
  Trophy,
  Users,
} from "lucide-react";
import type { ReactNode } from "react";
import { CopyLink } from "../../components/copy-link";
import {
  bracketHost,
  tournamentFormatSummary,
} from "../tournament-registration/presentation";
import type { EventDTO } from "./contracts";
import { eventAudienceIcons } from "./event-facts";
import { EventGameCover } from "./event-game-cover";
import { EventTimeText } from "./event-time-text";
import {
  eventAudienceLabels,
  eventTimeRange,
  formatEventDate,
  recurrenceRuleLabel,
  safeExternalEventUrl,
  zoneName,
} from "./presentation";

/**
 * Everything someone needs to decide whether to go, in one card: when,
 * where, the games, cost, who may come, how a tournament is played, and
 * how many are going, then the RSVP or registration controls (`children`)
 * and the event's link. Each fact appears here and nowhere else on the page.
 */
export function EventSummary({
  children,
  event,
  publicOrigin,
  renderedAt,
}: {
  children: ReactNode;
  event: EventDTO;
  publicOrigin: string;
  renderedAt: Date;
}) {
  const cancelled = Boolean(event.cancelled_at);
  const tournament = event.tournament;
  const onlineURL = safeExternalEventUrl(event.online_url);
  const paymentURL = safeExternalEventUrl(event.payment_url);
  const bracketURL = safeExternalEventUrl(tournament?.bracket_url);
  const hasPlace = event.format !== "online";
  const directionsURL =
    hasPlace && (event.address || event.location_name)
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
          [event.location_name, event.address].filter(Boolean).join(", "),
        )}`
      : undefined;
  const AudienceIcon = event.audience
    ? eventAudienceIcons[event.audience]
    : undefined;

  return (
    <section className="event-summary" aria-label="Event details">
      <ul className="event-summary__facts">
        <li>
          <CalendarDays aria-hidden="true" size={20} strokeWidth={1.75} />
          <div>
            <strong>
              <time dateTime={event.starts_at}>
                <EventTimeText range={eventTimeRange(event, renderedAt)} />
              </time>
            </strong>
            <small>
              {zoneName(new Date(event.starts_at), event.timezone, "long") ||
                event.timezone.replaceAll("_", " ")}
            </small>
            {event.recurrence_rule && event.recurrence_until ? (
              <small>
                {`${recurrenceRuleLabel(event.recurrence_rule)} until ${formatEventDate(event.recurrence_until, event.timezone)}`}
              </small>
            ) : null}
            {cancelled ? null : (
              <a
                className="text-action"
                href={`/api/events/${encodeURIComponent(event.slug)}/calendar.ics`}
              >
                <CalendarPlus aria-hidden="true" size={16} strokeWidth={1.75} />
                Add to calendar
              </a>
            )}
          </div>
        </li>
        {hasPlace ? (
          <li>
            <MapPin aria-hidden="true" size={20} strokeWidth={1.75} />
            <div>
              <strong>
                {event.location_name ||
                  event.address ||
                  "Location to be announced"}
              </strong>
              {event.location_name && event.address ? (
                <small>{event.address}</small>
              ) : null}
              {directionsURL ? (
                <a className="text-action" href={directionsURL}>
                  Get directions
                </a>
              ) : null}
            </div>
          </li>
        ) : null}
        {event.format !== "in_person" ? (
          <li>
            <Globe aria-hidden="true" size={20} strokeWidth={1.75} />
            <div>
              <strong>
                {event.format === "hybrid" ? "Also online" : "Online event"}
              </strong>
              {/* The API sends the meeting link only to people going and to
                  organizers, so its presence decides what shows. */}
              {onlineURL ? (
                <>
                  <small className="online-url">{onlineURL}</small>
                  <a
                    className="button button--primary button--small calendar-action"
                    href={onlineURL}
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    Join online
                    <span className="visually-hidden">
                      {" "}
                      (opens in a new tab)
                    </span>
                  </a>
                </>
              ) : (
                <small>The link is shared with people who are going.</small>
              )}
            </div>
          </li>
        ) : null}
        {event.games.map((game) => (
          <li key={game.id}>
            <EventGameCover hasCover={game.has_cover} slug={game.slug} />
            <div>
              <strong>{game.name}</strong>
            </div>
          </li>
        ))}
        {event.cost === "free" ? (
          <li>
            <Ticket aria-hidden="true" size={20} strokeWidth={1.75} />
            <div>
              <strong>Free</strong>
            </div>
          </li>
        ) : event.cost === "paid" ? (
          <li>
            <Ticket aria-hidden="true" size={20} strokeWidth={1.75} />
            <div>
              <strong>Paid</strong>
              <small>{event.payment_note || "Payment happens off CGN."}</small>
              {paymentURL ? (
                <a
                  className="text-action"
                  href={paymentURL}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  Open payment link
                  <span className="visually-hidden"> (opens in a new tab)</span>
                </a>
              ) : null}
            </div>
          </li>
        ) : null}
        {event.audience && AudienceIcon ? (
          <li>
            <AudienceIcon aria-hidden="true" size={20} strokeWidth={1.75} />
            <div>
              <strong>{eventAudienceLabels[event.audience]}</strong>
            </div>
          </li>
        ) : null}
        {tournament ? (
          <li>
            <Trophy aria-hidden="true" size={20} strokeWidth={1.75} />
            <div>
              <strong>{tournamentFormatSummary(tournament)}</strong>
              {/* A bracket hosted elsewhere is a link out, never embedded. */}
              {bracketURL ? (
                <a
                  className="link with-arrow"
                  href={bracketURL}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  {`Bracket on ${bracketHost(bracketURL)}`}
                  <ExternalLink
                    aria-hidden="true"
                    size={14}
                    strokeWidth={2.25}
                  />
                  <span className="visually-hidden">
                    {" "}
                    (external site, opens in a new tab)
                  </span>
                </a>
              ) : null}
            </div>
          </li>
        ) : null}
        <li>
          <Users aria-hidden="true" size={20} strokeWidth={1.75} />
          <div>
            <strong>
              {tournament
                ? tournament.entrant_cap
                  ? `${tournament.entry_count} of ${tournament.entrant_cap} registered`
                  : `${tournament.entry_count} registered`
                : event.capacity
                  ? `${event.rsvp_yes_count} of ${event.capacity} going`
                  : `${event.rsvp_yes_count} going`}
            </strong>
            {event.interest_count > 0 ? (
              <small>{event.interest_count} interested</small>
            ) : null}
          </div>
        </li>
      </ul>
      {children}
      <CopyLink
        label="Event link"
        shareTitle={event.title}
        url={`${publicOrigin}/events/${encodeURIComponent(event.slug)}`}
      />
    </section>
  );
}
