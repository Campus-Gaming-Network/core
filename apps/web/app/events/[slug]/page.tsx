import { Alert } from "@heroui/react/alert";
import { Button } from "@heroui/react/button";
import { Card } from "@heroui/react/card";
import { Chip } from "@heroui/react/chip";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { deleteEventAction, eventInterestAction } from "../../actions";
import { EventBanner } from "../../../components/event-banner";
import { EventRSVPForm } from "../../../components/event-rsvp-form";
import { PrivateEventUnlockForm } from "../../../components/private-event-unlock-form";
import { ReportForm } from "../../../components/report-form";
import {
  ApiError,
  eventFormatLabel,
  eventLifecycleLabel,
  eventLocation,
  eventTimeRange,
  eventVisibilityLabel,
  isLockedEvent,
  roleIndicatorLabel,
  recurrenceRuleLabel
} from "../../../lib/cgn-api";
import { pageMetadata } from "../../../lib/metadata";
import { currentProfile, getEvent } from "../../../lib/server-api";

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({
  params
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  // Resolve the missing case the same way the page body does. If this returned
  // fallback metadata instead, the response would commit at 200 before the page
  // called notFound(), and a missing event would answer 200 instead of 404.
  const event = await getEvent(slug, {
    includeCookie: true,
    includeUnlock: true
  }).catch((error) => {
    if (error instanceof ApiError && error.status === 404) {
      notFound();
    }

    throw error;
  });

  // A locked private event must not put its real title or description in the
  // page head. The event body is gated behind the password form, and metadata
  // is part of the same guarantee.
  if (isLockedEvent(event)) {
    return pageMetadata({
      title: "Private event",
      description: "This event is private. Enter the password to view it.",
      noIndex: true
    });
  }

  return pageMetadata({
    title: event.title,
    description:
      event.description ||
      `A campus gaming event hosted by ${event.host_school.name}.`,
    path: `/events/${event.slug}`,
    // Unlisted events are reachable by direct link but must stay out of
    // search results.
    noIndex: event.visibility !== "public"
  });
}

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
          <Link className="button button--secondary" href="/events">
            Browse public events
          </Link>
          {profile ? null : (
            <Link className="button button--primary" href={`/login?next=/events/${slug}`}>
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
          <Chip>{eventLifecycleLabel(event.lifecycle)}</Chip>
          <Chip>{eventVisibilityLabel(event.visibility)}</Chip>
          <Chip>{eventFormatLabel(event.format)}</Chip>
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
            <Link className="link" href={`/schools/${event.host_school.slug}`}>
              {event.host_school.name}
            </Link>
          </strong>
        </div>
        <div className="detail-row">
          <span>Games</span>
          <strong>{event.games.map((game) => game.name).join(", ")}</strong>
        </div>
        {event.recurrence_rule && event.recurrence_until ? (
          <div className="detail-row">
            <span>Repeats</span>
            <strong>
              {recurrenceRuleLabel(event.recurrence_rule)} until {new Date(event.recurrence_until).toLocaleDateString()}
            </strong>
          </div>
        ) : null}
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

      {event.organizers && event.organizers.length > 0 ? (
        <section className="section" aria-labelledby="event-organizers">
          <h2 id="event-organizers">Organizers</h2>
          <div className="pill-list">
            {event.organizers.map((organizer) => (
              <span className="pill-list-item" key={organizer.id}>
                <Link className="link" href={`/users/${organizer.id}`}>
                  {organizer.name}
                </Link>
                {organizer.role_indicators?.map((role) => (
                  <Chip key={`${organizer.id}-${role}`}>{roleIndicatorLabel(role)}</Chip>
                ))}
              </span>
            ))}
          </div>
        </section>
      ) : null}

      <Card className="action-panel" aria-labelledby="event-actions">
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
              <Button
                variant={event.viewer_interested ? "secondary" : "primary"}
                type="submit"
              >
                {event.viewer_interested ? "Remove interested" : "I'm interested"}
              </Button>
            </form>
            <EventRSVPForm event={event} />
            {event.viewer_can_edit ? (
              <div className="actions">
                <Link className="button button--secondary" href={`/events/${event.slug}/edit`}>
                  Edit event
                </Link>
                <form action={deleteEventAction}>
                  <input type="hidden" name="slug" value={event.slug} />
                  <Button variant="secondary" type="submit">
                    Cancel event
                  </Button>
                </form>
              </div>
            ) : null}
            <p className="form-footer">
              Yes RSVPs send a confirmation email with a calendar file.
            </p>
            <section aria-labelledby="report-event">
              <h3 id="report-event">Report this event</h3>
              <ReportForm targetID={event.slug} targetType="event" />
            </section>
          </>
        ) : (
          <div className="actions">
            <Link className="button button--primary" href={`/login?next=/events/${event.slug}`}>
              Log in to RSVP or mark interested
            </Link>
          </div>
        )}
      </Card>
    </main>
  );
}

function EventNotice({ status }: { status: string }) {
  const messages: Record<string, string> = {
    created: "Event created.",
    "cancel-failed": "We could not cancel that event. Please try again.",
    "delete-failed": "We could not cancel that event. Please try again.",
    "interest-added": "Marked as interested.",
    "interest-failed": "We could not update your interest. Please try again.",
    "interest-removed": "Removed from interested events.",
    "rsvp-updated": "RSVP saved.",
    unlocked: "Event unlocked.",
    updated: "Event updated."
  };

  return (
    <Alert
      status={status === "delete-failed" ? "danger" : "success"}
    >
      {messages[status] ?? ""}
    </Alert>
  );
}

function param(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}
