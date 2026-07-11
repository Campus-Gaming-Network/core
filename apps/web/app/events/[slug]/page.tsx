import Link from "next/link";
import { notFound } from "next/navigation";
import { deleteEventAction, eventInterestAction } from "../../actions";
import { EventBanner } from "../../../components/event-banner";
import { EventRSVPForm } from "../../../components/event-rsvp-form";
import { PrivateEventUnlockForm } from "../../../components/private-event-unlock-form";
import {
  ApiError,
  eventFormatLabel,
  eventLifecycleLabel,
  eventLocation,
  eventTimeRange,
  eventVisibilityLabel,
  isLockedEvent
} from "../../../lib/cgn-api";
import { currentProfile, getEvent } from "../../../lib/server-api";

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function EventDetailPage({
  params,
  searchParams
}: PageProps) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const [profile, event] = await Promise.all([
    currentProfile(),
    getEvent(slug, { includeCookie: true, includeUnlock: true }).catch((error) => {
      if (error instanceof ApiError && error.status === 404) {
        notFound();
      }

      throw error;
    })
  ]);
  const notice = param(query.event);

  if (isLockedEvent(event)) {
    return (
      <main className="narrow">
        <EventBanner locked size="hero" />
        <section className="page-heading">
          <p className="eyebrow">Private event</p>
          <h1>This event is private.</h1>
          <p className="lede">
            Enter the event password to reveal the details. Nothing private is
            sent to the browser until the password checks out.
          </p>
        </section>
        <PrivateEventUnlockForm slug={slug} />
        <div className="actions">
          <Link className="button" href="/events">
            Browse public events
          </Link>
          {profile ? null : (
            <Link className="button primary" href={`/login?next=/events/${slug}`}>
              Log in
            </Link>
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="narrow">
      <EventBanner event={event} size="hero" />
      <section className="page-heading">
        <p className="eyebrow">Event</p>
        <h1>{event.title}</h1>
        <p className="lede">{event.description || "Event details are coming soon."}</p>
        <div className="pill-list">
          <span>{eventLifecycleLabel(event.lifecycle)}</span>
          <span>{eventVisibilityLabel(event.visibility)}</span>
          <span>{eventFormatLabel(event.format)}</span>
        </div>
      </section>

      {notice ? <EventNotice status={notice} /> : null}

      <section className="detail-grid" aria-label="Event details">
        <div className="detail-row">
          <span>When</span>
          <strong>{eventTimeRange(event)}</strong>
        </div>
        <div className="detail-row">
          <span>Where</span>
          <strong>{eventLocation(event)}</strong>
        </div>
        <div className="detail-row">
          <span>Host school</span>
          <strong>
            <Link href={`/schools/${event.host_school.slug}`}>
              {event.host_school.name}
            </Link>
          </strong>
        </div>
        <div className="detail-row">
          <span>Games</span>
          <strong>{event.games.map((game) => game.name).join(", ")}</strong>
        </div>
        {event.capacity ? (
          <div className="detail-row">
            <span>Capacity</span>
            <strong>
              {event.rsvp_yes_count} / {event.capacity}
            </strong>
          </div>
        ) : null}
        <div className="detail-row">
          <span>Interested</span>
          <strong>{event.interest_count}</strong>
        </div>
        {event.is_paid ? (
          <div className="detail-row">
            <span>Payment</span>
            <strong className="detail-value">
              {event.payment_note || "Payment happens off CGN."}
              {event.payment_url ? <a href={event.payment_url}>Payment link</a> : null}
            </strong>
          </div>
        ) : null}
      </section>

      <section className="action-panel" aria-labelledby="event-actions">
        <h2 id="event-actions">Event actions</h2>
        {profile ? (
          <>
            <form action={eventInterestAction} className="interest-form">
              <input type="hidden" name="slug" value={event.slug} />
              <input
                type="hidden"
                name="interested"
                value={event.viewer_interested ? "false" : "true"}
              />
              <button
                className={event.viewer_interested ? "secondary" : "primary"}
                type="submit"
              >
                {event.viewer_interested ? "Remove interested" : "I'm interested"}
              </button>
            </form>
            <EventRSVPForm event={event} />
            <div className="actions">
              <Link className="button" href={`/events/${event.slug}/edit`}>
                Edit event
              </Link>
              <form action={deleteEventAction}>
                <input type="hidden" name="slug" value={event.slug} />
                <button className="secondary" type="submit">
                  Delete event
                </button>
              </form>
            </div>
            <p className="form-footer">
              Yes RSVPs send a confirmation email with a calendar file.
            </p>
          </>
        ) : (
          <div className="actions">
            <Link className="button primary" href={`/login?next=/events/${event.slug}`}>
              Log in to RSVP or mark interested
            </Link>
          </div>
        )}
      </section>
    </main>
  );
}

function EventNotice({ status }: { status: string }) {
  const messages: Record<string, string> = {
    created: "Event created.",
    "delete-failed": "We could not delete that event. Please try again.",
    "interest-added": "Marked as interested.",
    "interest-failed": "We could not update your interest. Please try again.",
    "interest-removed": "Removed from interested events.",
    "rsvp-updated": "RSVP saved.",
    unlocked: "Event unlocked.",
    updated: "Event updated."
  };

  return (
    <p className={`notice ${status === "delete-failed" ? "error" : "success"}`}>
      {messages[status] ?? ""}
    </p>
  );
}

function param(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}
