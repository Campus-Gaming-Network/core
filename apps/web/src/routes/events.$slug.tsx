import {
  Link,
  createFileRoute,
  notFound,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  CircleHelp,
  Flag,
  Mail,
  MapPin,
  Star,
  X,
} from "lucide-react";
import { type FormEvent, useRef, useState } from "react";
import { ButtonLink } from "../components/button-link";
import { CalendarDate } from "../components/calendar-date";
import { Callout } from "../components/callout";
import { CopyLink } from "../components/copy-link";
import { ConfirmDialog } from "../components/confirm-dialog";
import {
  FieldError,
  FormErrorSummary,
  fieldErrorProps,
  useEnhancedMutation,
} from "../components/enhanced-mutation";
import { FormField } from "../components/form-field";
import {
  newIdempotencyKey,
  useIdempotencyKey,
} from "../components/idempotency-key";
import { pageNoticeKey } from "../components/page-notice";
import { PageNoticeView } from "../components/page-notice-view";
import { Person } from "../components/person";
import { RouteErrorView, RoutePending } from "../components/route-boundaries";
import { StatusLabel } from "../components/status-label";
import {
  cancelEvent,
  getEventDetail,
  reportEvent,
  rsvpEvent,
  setEventInterest,
  unlockEvent,
} from "../features/event-slice/event.functions";
import { getEventViewerSession } from "../features/event-slice/auth.functions";
import { EventBanner } from "../features/event-slice/event-banner";
import type {
  EventDTO,
  EventDetailDTO,
  LockedEventDTO,
} from "../features/event-slice/contracts";
import {
  eventDetailNotices,
  eventAudienceLabels,
  eventFormatLabel,
  eventLifecycleLabel,
  eventLocation,
  eventRSVPLabel,
  eventTimeRange,
  eventVisibilityLabel,
  formatEventDate,
  recurrenceRuleLabel,
  type EventDetailNotice,
  safeExternalEventUrl,
} from "../features/event-slice/presentation";
import eventCSS from "../features/event-slice/events.css?url";
import {
  peoplePreviewSize,
  type PeopleListResult,
} from "../features/people-slice/contracts";
import { getEventAttendees } from "../features/people-slice/people.functions";
import {
  PeoplePreview,
  PeopleSignedOut,
} from "../features/people-slice/people-views";
import { verificationDetail } from "../features/people-slice/presentation";

const siteName = "Campus Gaming Network";
const privateEventDescription =
  "This event is private. Enter the password to view it.";

export type EventRouteData = {
  event: EventDetailDTO;
  authenticated: boolean;
  /** The first people going, read only for a signed-in viewer of a visible event. */
  attendees?: PeopleListResult;
  publicOrigin: string;
  /** Server-rendered report key; see useIdempotencyKey. */
  idempotencyKey: string;
};

type EventSearch = {
  event?: EventDetailNotice;
};

export const Route = createFileRoute("/events/$slug")({
  validateSearch: validateEventSearch,
  loader: async ({ context, params }): Promise<EventRouteData> => {
    // Cookie forwarding, upstream validation, and private-event access checks
    // stay behind these server functions. The loader only consumes their safe
    // serializable DTOs.
    // The detail read deliberately runs last because it applies the stricter
    // private cache policy required for unlock-sensitive event responses.
    // Running these server functions concurrently lets their response-header
    // side effects race in the development runtime.
    const session = await getEventViewerSession();
    const detail = await getEventDetail({ data: { slug: params.slug } });

    if (detail.status === "not_found") {
      throw notFound();
    }

    if (detail.status !== "found") {
      throw new Error("Event detail is unavailable");
    }

    if (session.status === "unavailable") {
      throw new Error("Event viewer session is unavailable");
    }

    // Who is going is for signed-in viewers only, and a locked event shows
    // nothing. A list that cannot be read is reported in the result and never
    // fails the page.
    const attendees =
      session.authenticated && !isLockedEvent(detail.event)
        ? await getEventAttendees({
            data: {
              slug: params.slug,
              response: "yes",
              limit: peoplePreviewSize,
            },
          })
        : undefined;

    return {
      event: detail.event,
      authenticated: session.authenticated,
      ...(attendees ? { attendees } : {}),
      publicOrigin: context.publicOrigin,
      idempotencyKey: newIdempotencyKey(),
    };
  },
  headers: () => ({
    "cache-control": "private, no-store",
    vary: "Cookie",
  }),
  head: ({ loaderData }) => ({
    ...eventHead(loaderData),
    links: [{ rel: "stylesheet", href: eventCSS }],
  }),
  pendingComponent: EventPending,
  errorComponent: EventError,
  component: EventPage,
});

export function validateEventSearch(
  search: Record<string, unknown>,
): EventSearch {
  const event = pageNoticeKey(eventDetailNotices, search.event);
  return event ? { event } : {};
}

export function eventHead(loaderData?: EventRouteData) {
  const event = loaderData?.event;

  if (!event || isLockedEvent(event)) {
    const title = `Private event | ${siteName}`;

    return {
      meta: [
        { title },
        { name: "description", content: privateEventDescription },
        { name: "robots", content: "noindex,nofollow" },
        { property: "og:type", content: "website" },
        { property: "og:site_name", content: siteName },
        { property: "og:title", content: title },
        { property: "og:description", content: privateEventDescription },
        { name: "twitter:card", content: "summary" },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: privateEventDescription },
      ],
    };
  }

  const title = `${event.title} | ${siteName}`;
  const description =
    event.description ||
    `A campus gaming event hosted by ${event.host_school.name}.`;

  return {
    meta: [
      { title },
      { name: "description", content: description },
      ...(event.visibility === "public"
        ? []
        : [{ name: "robots", content: "noindex,nofollow" }]),
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: siteName },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      {
        property: "og:url",
        content: `${loaderData.publicOrigin}/events/${encodeURIComponent(event.slug)}`,
      },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: title },
      { name: "twitter:description", content: description },
    ],
  };
}

function EventPage() {
  const { attendees, event, authenticated, publicOrigin } =
    Route.useLoaderData();
  const search = Route.useSearch();

  if (isLockedEvent(event)) {
    return (
      <LockedEventView
        slug={event.slug}
        authenticated={authenticated}
        notice={search.event}
      />
    );
  }

  return (
    <VisibleEventView
      attendees={attendees}
      event={event}
      authenticated={authenticated}
      notice={search.event}
      publicOrigin={publicOrigin}
    />
  );
}

export function LockedEventView({
  slug,
  authenticated,
  notice,
}: {
  slug: string;
  authenticated: boolean;
  notice?: EventDetailNotice;
}) {
  return (
    <main className="narrow">
      <EventBanner locked size="hero" />
      <section className="page-heading">
        <p className="eyebrow">Private event</p>
        <h1>This event is private.</h1>
        <p className="lede">Enter the event password to reveal the details.</p>
        <Callout icon="lock">
          Nothing private is sent to the browser until the password checks out.
        </Callout>
      </section>
      <PageNoticeView
        notice={notice ? eventDetailNotices[notice] : undefined}
      />
      <UnlockEventForm slug={slug} />
      <div className="actions">
        <ButtonLink variant="secondary" to="/events">
          Browse public events
        </ButtonLink>
        {authenticated ? null : (
          <ButtonLink
            variant="primary"
            to="/login"
            search={{ next: `/events/${slug}` }}
          >
            Log in
          </ButtonLink>
        )}
      </div>
    </main>
  );
}

function VisibleEventView({
  attendees,
  event,
  authenticated,
  notice,
  publicOrigin,
}: {
  attendees?: PeopleListResult;
  event: EventDTO;
  authenticated: boolean;
  notice?: EventSearch["event"];
  publicOrigin: string;
}) {
  const paymentURL = safeExternalEventUrl(event.payment_url);
  const directionsURL =
    event.address || event.location_name
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
          [event.location_name, event.address].filter(Boolean).join(", "),
        )}`
      : undefined;

  return (
    <main className="event-page">
      <EventBanner event={event} size="hero" />
      <Link className="back-link with-arrow" to="/events">
        <ArrowLeft aria-hidden="true" size={14} strokeWidth={2.25} />
        Back to events
      </Link>
      <header className="event-detail-header">
        <CalendarDate
          size="large"
          startsAt={event.starts_at}
          timezone={event.timezone}
        />
        <div>
          <div className="event-pill-list">
            {event.lifecycle !== "upcoming" ? (
              <StatusLabel status={event.lifecycle}>
                {eventLifecycleLabel(event.lifecycle)}
              </StatusLabel>
            ) : null}
            <StatusLabel>{eventVisibilityLabel(event.visibility)}</StatusLabel>
            <StatusLabel>{eventFormatLabel(event.format)}</StatusLabel>
            {event.audience ? (
              <StatusLabel>{eventAudienceLabels[event.audience]}</StatusLabel>
            ) : null}
          </div>
          <h1>{event.title}</h1>
          <p className="event-hostline">
            Hosted by{" "}
            <Link to="/schools/$slug" params={{ slug: event.host_school.slug }}>
              {event.host_school.name}
            </Link>
          </p>
        </div>
      </header>

      <PageNoticeView
        notice={notice ? eventDetailNotices[notice] : undefined}
      />

      <div className="event-detail-layout">
        <div className="event-detail-main">
          <section className="event-about" aria-labelledby="event-about-title">
            <h2 id="event-about-title">About this event</h2>
            <p className="lede">
              {event.description || "Event details are coming soon."}
            </p>
          </section>

          <section
            className="detail-card event-facts"
            aria-labelledby="event-facts-title"
          >
            <h2 id="event-facts-title">Event details</h2>
            <div className="detail-row">
              <span>Games</span>
              <strong>
                {event.games.length > 0
                  ? event.games.map((game) => game.name).join(", ")
                  : "To be announced"}
              </strong>
            </div>
            <div className="detail-row">
              <span>{event.capacity ? "Attending" : "Going"}</span>
              <strong>
                {event.capacity
                  ? `${event.rsvp_yes_count} of ${event.capacity}`
                  : event.rsvp_yes_count}
              </strong>
            </div>
            <div className="detail-row">
              <span>Interested</span>
              <strong>{event.interest_count}</strong>
            </div>
            {event.recurrence_rule && event.recurrence_until ? (
              <div className="detail-row">
                <span>Repeats</span>
                <strong>
                  {recurrenceRuleLabel(event.recurrence_rule)} until{" "}
                  {formatEventDate(event.recurrence_until, event.timezone)}
                </strong>
              </div>
            ) : null}
          </section>

          {authenticated ? (
            <section
              className="detail-card people-card"
              aria-labelledby="event-people-title"
            >
              <h2 id="event-people-title">{"Who's going"}</h2>
              <PeoplePreview
                empty="No one has RSVP'd yet."
                result={attendees ?? { status: "unavailable" }}
              />
              <div className="detail-card-body">
                <Link
                  className="link with-arrow"
                  to="/events/$slug/people"
                  params={{ slug: event.slug }}
                >
                  See everyone
                  <ArrowRight aria-hidden="true" size={14} strokeWidth={2.25} />
                </Link>
              </div>
            </section>
          ) : (
            <div className="people-card">
              <PeopleSignedOut
                message="Log in to see who's going."
                next={`/events/${event.slug}`}
              />
            </div>
          )}

          {event.organizers && event.organizers.length > 0 ? (
            <section
              className="section section--compact"
              aria-labelledby="event-organizers"
            >
              <h2 id="event-organizers">Organizers</h2>
              <ul className="organizer-list">
                {event.organizers.map((organizer) => (
                  <li key={organizer.id}>
                    <Person
                      detail={verificationDetail(organizer)}
                      id={organizer.id}
                      linked
                      name={organizer.name}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {authenticated ? (
            <section
              className="section section--compact"
              aria-label="Event safety and management"
            >
              {event.viewer_can_edit ? (
                <>
                  <h2 id="manage-event">Manage event</h2>
                  <div className="actions">
                    <ButtonLink
                      variant="secondary"
                      to="/events/$slug/edit"
                      params={{ slug: event.slug }}
                    >
                      Edit event
                    </ButtonLink>
                    <CancelEventForm slug={event.slug} />
                  </div>
                </>
              ) : null}
              <details className="safety-details">
                <summary>
                  <Flag aria-hidden="true" size={14} strokeWidth={1.75} />
                  Report this event
                </summary>
                <ReportEventForm slug={event.slug} />
              </details>
            </section>
          ) : null}
        </div>

        <aside
          className="event-detail-sidebar"
          aria-label="RSVP and event info"
        >
          <section
            className="detail-card rsvp-card"
            aria-labelledby="event-rsvp-title"
          >
            <h2 id="event-rsvp-title">RSVP</h2>
            <div className="detail-card-body">
              {authenticated ? (
                <>
                  <RsvpEventForm event={event} />
                  <InterestEventForm event={event} />
                </>
              ) : (
                <ButtonLink
                  variant="primary"
                  to="/login"
                  search={{ next: `/events/${event.slug}` }}
                >
                  Log in to RSVP
                </ButtonLink>
              )}
              <p className="rsvp-help">
                <Mail aria-hidden="true" size={14} strokeWidth={1.75} />
                Going RSVPs get a confirmation email with a calendar file.
              </p>
            </div>
          </section>

          <section className="detail-card">
            <h2>When and where</h2>
            <div className="detail-card-row">
              <CalendarDays aria-hidden="true" size={18} strokeWidth={1.75} />
              <div>
                <strong>{eventTimeRange(event)}</strong>
                <small>{event.timezone.replaceAll("_", " ")}</small>
                <a
                  className="text-action"
                  href={`/api/events/${encodeURIComponent(event.slug)}/calendar.ics`}
                >
                  Add to calendar
                </a>
              </div>
            </div>
            <div className="detail-card-row">
              <MapPin aria-hidden="true" size={18} strokeWidth={1.75} />
              <div>
                <strong>{eventLocation(event)}</strong>
                {event.address ? <small>{event.address}</small> : null}
                {directionsURL ? (
                  <a className="text-action" href={directionsURL}>
                    Get directions
                  </a>
                ) : null}
              </div>
            </div>
          </section>

          <section className="detail-card">
            <h2>Share</h2>
            <CopyLink
              label="Event link"
              url={`${publicOrigin}/events/${encodeURIComponent(event.slug)}`}
            />
          </section>

          {event.is_paid ? (
            <section className="detail-card">
              <h2>Payment</h2>
              <div className="detail-card-body">
                <p>{event.payment_note || "Payment happens off CGN."}</p>
                {paymentURL ? <a href={paymentURL}>Open payment link</a> : null}
              </div>
            </section>
          ) : null}
        </aside>
      </div>
    </main>
  );
}

function InterestEventForm({ event }: { event: EventDTO }) {
  const runSetEventInterest = useServerFn(setEventInterest);
  const mutation = useEnhancedMutation(
    "We could not update your interest. Please try again.",
  );
  const interested = !event.viewer_interested;

  async function submit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    await mutation.execute(() =>
      runSetEventInterest({ data: { slug: event.slug, interested } }),
    );
  }

  return (
    <form
      action={setEventInterest.url}
      className="interest-form"
      method="post"
      onSubmit={submit}
    >
      <input name="slug" type="hidden" value={event.slug} />
      <input name="interested" type="hidden" value={String(interested)} />
      {mutation.message ? <p role="alert">{mutation.message}</p> : null}
      <button
        className={
          event.viewer_interested ? "interest-toggle is-on" : "interest-toggle"
        }
        disabled={mutation.pending}
        type="submit"
      >
        <Star
          aria-hidden="true"
          fill={event.viewer_interested ? "currentColor" : "none"}
          size={16}
          strokeWidth={1.75}
        />
        {mutation.pending
          ? "Saving interest…"
          : event.viewer_interested
            ? "Remove interested"
            : "I'm interested"}
      </button>
    </form>
  );
}

function CancelEventForm({ slug }: { slug: string }) {
  const runCancelEvent = useServerFn(cancelEvent);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [confirming, setConfirming] = useState(false);
  const mutation = useEnhancedMutation(
    "We could not cancel that event. Please try again.",
  );

  async function submit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    if (!confirming) {
      setConfirming(true);
      return;
    }
    await mutation.execute(() => runCancelEvent({ data: { slug } }));
  }

  return (
    <form action={cancelEvent.url} method="post" onSubmit={submit}>
      <input name="slug" type="hidden" value={slug} />
      <button
        className="button--destructive"
        disabled={mutation.pending}
        ref={triggerRef}
        type="submit"
      >
        Cancel event
      </button>
      <ConfirmDialog
        cancelLabel="Keep event"
        confirmLabel="Yes, cancel event"
        heading="Cancel this event?"
        onClose={() => setConfirming(false)}
        open={confirming}
        pending={mutation.pending}
        returnFocusRef={triggerRef}
      >
        <p>
          Attendees will no longer be able to RSVP. This action cannot be
          undone.
        </p>
        {mutation.message ? <p role="alert">{mutation.message}</p> : null}
      </ConfirmDialog>
    </form>
  );
}

function ReportEventForm({ slug }: { slug: string }) {
  const runReportEvent = useServerFn(reportEvent);
  const idempotency = useIdempotencyKey(
    Route.useLoaderData({ select: (data) => data.idempotencyKey }),
  );
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [reasonErrors, setReasonErrors] = useState<string[] | undefined>();

  async function submit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    const formElement = formEvent.currentTarget;
    const form = new FormData(formElement);
    setPending(true);
    setMessage("");
    setFailed(false);
    setReasonErrors(undefined);
    try {
      const result = await runReportEvent({
        data: {
          slug,
          reason: String(form.get("reason") ?? ""),
          idempotency_key: idempotency.key,
        },
      });
      if (result.status === "error") {
        setFailed(true);
        setMessage(
          result.fieldErrors?.reason?.length
            ? result.message
            : "We could not submit that report. Please try again.",
        );
        setReasonErrors(result.fieldErrors?.reason);
      } else {
        setMessage(result.message);
        formElement.reset();
        idempotency.rotate();
      }
    } catch {
      setFailed(true);
      setMessage("We could not submit that report. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      action={reportEvent.url}
      className="form-stack report-form"
      method="post"
      onSubmit={submit}
    >
      <input name="slug" type="hidden" value={slug} />
      <input name="idempotency_key" type="hidden" value={idempotency.key} />
      {message ? (
        <p role={failed ? "alert" : "status"} aria-live="polite">
          {message}
        </p>
      ) : null}
      <FormField
        errorId="event-report-reason-error"
        errors={reasonErrors}
        label="Reason"
      >
        <textarea maxLength={2000} name="reason" required rows={3} />
      </FormField>
      <button disabled={pending} type="submit">
        {pending ? "Submitting…" : "Submit report"}
      </button>
    </form>
  );
}

function UnlockEventForm({ slug }: { slug: string }) {
  const runUnlockEvent = useServerFn(unlockEvent);
  const mutation = useEnhancedMutation(
    "We could not unlock that event. Please try again.",
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

    await mutation.execute(() =>
      runUnlockEvent({
        data: {
          slug,
          password: String(form.get("password") ?? ""),
        },
      }),
    );
  }

  const passwordErrors = mutation.fieldErrors.password;

  return (
    <form
      action={unlockEvent.url}
      className="inline-form private-unlock-form"
      method="post"
      onSubmit={submit}
    >
      <input type="hidden" name="slug" value={slug} />
      <FormErrorSummary
        fieldErrors={mutation.fieldErrors}
        fieldIds={{ password: "event-password-error" }}
        message={mutation.message}
        summaryRef={mutation.errorSummaryRef}
      />
      <FormField
        errorId="event-password-error"
        errors={passwordErrors}
        label="Event password"
      >
        <input
          name="password"
          type="password"
          autoComplete="off"
          required
          minLength={8}
          maxLength={256}
        />
      </FormField>
      <button type="submit" disabled={mutation.pending}>
        {mutation.pending ? "Unlocking…" : "Unlock event"}
      </button>
    </form>
  );
}

const rsvpIcons = { maybe: CircleHelp, no: X, yes: Check } as const;

function RsvpEventForm({ event }: { event: EventDTO }) {
  const runRsvpEvent = useServerFn(rsvpEvent);
  const mutation = useEnhancedMutation(
    "We could not save your RSVP. Please try again.",
  );
  const isEnded = event.lifecycle === "ended";
  const isFullForViewer =
    event.lifecycle === "full" && event.viewer_rsvp !== "yes";

  async function submit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    const submitter = (formEvent.nativeEvent as SubmitEvent)
      .submitter as HTMLButtonElement | null;
    const response = submitter?.value;

    if (response !== "yes" && response !== "maybe" && response !== "no") {
      await mutation.execute(async () => ({
        status: "error",
        message: "Check the highlighted fields and try again.",
        fieldErrors: { response: ["Choose yes, maybe, or no."] },
      }));
      return;
    }

    await mutation.execute(() =>
      runRsvpEvent({
        data: { slug: event.slug, response },
      }),
    );
  }

  const responseErrors = mutation.fieldErrors.response;

  return (
    <form
      action={rsvpEvent.url}
      className="rsvp-form"
      method="post"
      onSubmit={submit}
    >
      <input type="hidden" name="slug" value={event.slug} />
      <FormErrorSummary
        fieldErrors={mutation.fieldErrors}
        fieldIds={{ response: "event-rsvp-error" }}
        message={mutation.message}
        summaryRef={mutation.errorSummaryRef}
      />
      <p className="rsvp-current">
        Current RSVP:{" "}
        <strong>
          {event.viewer_rsvp ? eventRSVPLabel(event.viewer_rsvp) : "Not set"}
        </strong>
      </p>
      {mutation.pending ? (
        <p aria-live="polite" className="rsvp-note" role="status">
          Saving your RSVP…
        </p>
      ) : null}
      {isEnded ? (
        <p className="rsvp-note">RSVPs are closed for ended events.</p>
      ) : null}
      {isFullForViewer ? (
        <p className="rsvp-note">
          This event is full, but you can still choose maybe or no.
        </p>
      ) : null}
      <div aria-label="Your RSVP" className="rsvp-buttons" role="group">
        {(["yes", "maybe", "no"] as const).map((response) => {
          const RsvpIcon = rsvpIcons[response];
          return (
            <button
              aria-pressed={event.viewer_rsvp === response}
              {...fieldErrorProps(responseErrors, "event-rsvp-error")}
              disabled={
                mutation.pending ||
                isEnded ||
                (response === "yes" && isFullForViewer)
              }
              key={response}
              name="response"
              type="submit"
              value={response}
            >
              <RsvpIcon aria-hidden="true" size={16} strokeWidth={2} />
              {eventRSVPLabel(response)}
            </button>
          );
        })}
      </div>
      <FieldError id="event-rsvp-error" messages={responseErrors} />
    </form>
  );
}

function EventPending() {
  return <RoutePending message="Loading event…" />;
}

function EventError({ reset }: ErrorComponentProps) {
  return (
    <RouteErrorView
      reset={reset}
      eyebrow="Event unavailable"
      heading="We could not load this event."
      description="Please try again in a moment."
      showNavigation={false}
    />
  );
}

function isLockedEvent(event: EventDetailDTO): event is LockedEventDTO {
  return "locked" in event && event.locked === true;
}
