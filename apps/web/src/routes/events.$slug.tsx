import {
  Link,
  createFileRoute,
  notFound,
  type ErrorComponentProps
} from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { type FormEvent, useState } from "react";
import {
  FieldError,
  fieldErrorProps,
  useEnhancedMutation
} from "../components/enhanced-mutation";
import {
  RouteErrorView,
  RoutePending
} from "../components/route-boundaries";
import {
  cancelEvent,
  getEventDetail,
  reportEvent,
  rsvpEvent,
  setEventInterest,
  unlockEvent
} from "../features/event-slice/event.functions";
import {
  getEventViewerSession,
  logout
} from "../features/event-slice/auth.functions";
import { EventBanner } from "../features/event-slice/event-banner";
import type {
  EventDTO,
  EventDetailDTO,
  EventNotice,
  LockedEventDTO
} from "../features/event-slice/contracts";
import { validateEventsSearch } from "../features/event-slice/contracts";
import {
  eventFormatLabel,
  eventLifecycleLabel,
  eventLocation,
  eventNoticeMessage,
  eventRSVPLabel,
  eventTimeRange,
  eventVisibilityLabel,
  formatEventDate,
  isFailureNotice,
  recurrenceRuleLabel,
  roleIndicatorLabel,
  safeExternalEventUrl,
  verificationLabel
} from "../features/event-slice/presentation";
import eventCSS from "../features/event-slice/events.css?url";

const siteName = "Campus Gaming Network";
const privateEventDescription =
  "This event is private. Enter the password to view it.";

export type EventRouteData = {
  event: EventDetailDTO;
  authenticated: boolean;
  publicOrigin: string;
};

type EventSearch = {
  event?: EventNotice;
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

    return {
      event: detail.event,
      authenticated: session.authenticated,
      publicOrigin: context.publicOrigin
    };
  },
  headers: () => ({
    "cache-control": "private, no-store",
    vary: "Cookie"
  }),
  head: ({ loaderData }) => ({
    ...eventHead(loaderData),
    links: [{ rel: "stylesheet", href: eventCSS }]
  }),
  pendingComponent: EventPending,
  errorComponent: EventError,
  component: EventPage
});

export function validateEventSearch(search: Record<string, unknown>): EventSearch {
  const event = validateEventsSearch(search).event;
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
        { name: "twitter:description", content: privateEventDescription }
      ]
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
        content: `${loaderData.publicOrigin}/events/${encodeURIComponent(event.slug)}`
      },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: title },
      { name: "twitter:description", content: description }
    ]
  };
}

function EventPage() {
  const { event, authenticated } = Route.useLoaderData();
  const search = Route.useSearch();

  if (isLockedEvent(event)) {
    return <LockedEventView slug={event.slug} authenticated={authenticated} />;
  }

  return (
    <VisibleEventView
      event={event}
      authenticated={authenticated}
      notice={search.event}
    />
  );
}

export function LockedEventView({
  slug,
  authenticated
}: {
  slug: string;
  authenticated: boolean;
}) {
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
      <UnlockEventForm slug={slug} />
      <NativeLogoutFallback authenticated={authenticated} />
      <div className="actions">
        <Link className="button button--secondary" to="/events">
          Browse public events
        </Link>
        {authenticated ? null : (
          <Link
            className="button button--primary"
            to="/login"
            search={{ next: `/events/${slug}` }}
          >
            Log in
          </Link>
        )}
      </div>
    </main>
  );
}

function VisibleEventView({
  event,
  authenticated,
  notice
}: {
  event: EventDTO;
  authenticated: boolean;
  notice?: EventSearch["event"];
}) {
  const paymentURL = safeExternalEventUrl(event.payment_url);

  return (
    <main className="narrow">
      <EventBanner event={event} size="hero" />
      <section className="page-heading">
        <p className="eyebrow">Event</p>
        <h1>{event.title}</h1>
        <p className="lede">
          {event.description || "Event details are coming soon."}
        </p>
        <div className="event-pill-list">
          <span className="event-pill">{eventLifecycleLabel(event.lifecycle)}</span>
          <span className="event-pill">{eventVisibilityLabel(event.visibility)}</span>
          <span className="event-pill">{eventFormatLabel(event.format)}</span>
        </div>
      </section>

      <NativeLogoutFallback authenticated={authenticated} />

      {notice ? (
        <p
          role={isFailureNotice(notice) ? "alert" : "status"}
          aria-live="polite"
        >
          {eventNoticeMessage(notice)}
        </p>
      ) : null}

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
            <Link
              to="/schools/$slug"
              params={{ slug: event.host_school.slug }}
            >
              {event.host_school.name}
            </Link>
          </strong>
        </div>
        <div className="detail-row">
          <span>Games</span>
          <strong>
            {event.games.length > 0
              ? event.games.map((game) => game.name).join(", ")
              : "Games to be announced"}
          </strong>
        </div>
        {event.capacity ? (
          <div className="detail-row">
            <span>Capacity</span>
            <strong>
              {event.rsvp_yes_count} / {event.capacity}
            </strong>
          </div>
        ) : null}
        {event.recurrence_rule && event.recurrence_until ? (
          <div className="detail-row">
            <span>Repeats</span>
            <strong>
              {recurrenceRuleLabel(event.recurrence_rule)} until{" "}
              {formatEventDate(event.recurrence_until, event.timezone)}
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
            <strong>
              {event.payment_note || "Payment happens off CGN."}
              {paymentURL ? (
                <>
                  {" "}
                  <a href={paymentURL}>Payment link</a>
                </>
              ) : null}
            </strong>
          </div>
        ) : null}
      </section>

      {event.organizers && event.organizers.length > 0 ? (
        <section aria-labelledby="event-organizers">
          <h2 id="event-organizers">Organizers</h2>
          <ul>
            {event.organizers.map((organizer) => (
              <li key={organizer.id}>
                <Link to="/users/$id" params={{ id: organizer.id }}>
                  {organizer.name}
                </Link>
                {" · "}
                {verificationLabel(organizer.verification_level)}
                {organizer.role_indicators
                  ?.filter((role) => role !== organizer.verification_level)
                  .map((role) => (
                    <span key={`${organizer.id}-${role}`}>
                      {" · "}
                      {roleIndicatorLabel(role)}
                    </span>
                  ))}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="action-panel" aria-labelledby="event-actions">
        <h2 id="event-actions">Event actions</h2>
        {authenticated ? (
          <>
            <InterestEventForm event={event} />
            <RsvpEventForm event={event} />
            {event.viewer_can_edit ? (
              <div className="actions">
                <Link
                  className="button button--secondary"
                  to="/events/$slug/edit"
                  params={{ slug: event.slug }}
                >
                  Edit event
                </Link>
                <CancelEventForm slug={event.slug} />
              </div>
            ) : null}
            <p className="form-footer">
              Yes RSVPs send a confirmation email with a calendar file.
            </p>
            <section aria-labelledby="report-event">
              <h3 id="report-event">Report this event</h3>
              <ReportEventForm slug={event.slug} />
            </section>
          </>
        ) : (
          <Link
            className="button button--primary"
            to="/login"
            search={{ next: `/events/${event.slug}` }}
          >
            Log in to RSVP or mark interested
          </Link>
        )}
      </section>
    </main>
  );
}

function NativeLogoutFallback({ authenticated }: { authenticated: boolean }) {
  if (!authenticated) return null;

  return (
    <noscript>
      <form action={logout.url} className="logout-form" method="post">
        <button type="submit">Log out</button>
      </form>
    </noscript>
  );
}

function InterestEventForm({ event }: { event: EventDTO }) {
  const runSetEventInterest = useServerFn(setEventInterest);
  const mutation = useEnhancedMutation(
    "We could not update your interest. Please try again."
  );
  const interested = !event.viewer_interested;

  async function submit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    await mutation.execute(() =>
      runSetEventInterest({ data: { slug: event.slug, interested } })
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
      <button disabled={mutation.pending} type="submit">
        {event.viewer_interested ? "Remove interested" : "I'm interested"}
      </button>
    </form>
  );
}

function CancelEventForm({ slug }: { slug: string }) {
  const runCancelEvent = useServerFn(cancelEvent);
  const mutation = useEnhancedMutation(
    "We could not cancel that event. Please try again."
  );

  async function submit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    await mutation.execute(() => runCancelEvent({ data: { slug } }));
  }

  return (
    <form action={cancelEvent.url} method="post" onSubmit={submit}>
      <input name="slug" type="hidden" value={slug} />
      <button disabled={mutation.pending} type="submit">
        {mutation.pending ? "Cancelling…" : "Cancel event"}
      </button>
    </form>
  );
}

function ReportEventForm({ slug }: { slug: string }) {
  const runReportEvent = useServerFn(reportEvent);
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
        data: { slug, reason: String(form.get("reason") ?? "") }
      });
      if (result.status === "error") {
        setFailed(true);
        setMessage(
          result.fieldErrors?.reason?.length
            ? result.message
            : "We could not submit that report. Please try again."
        );
        setReasonErrors(result.fieldErrors?.reason);
      } else {
        setMessage(result.message);
        formElement.reset();
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
      {message ? (
        <p role={failed ? "alert" : "status"} aria-live="polite">
          {message}
        </p>
      ) : null}
      <label>
        Reason
        <textarea
          maxLength={2000}
          name="reason"
          required
          rows={3}
          {...fieldErrorProps(reasonErrors, "event-report-reason-error")}
        />
        <FieldError id="event-report-reason-error" messages={reasonErrors} />
      </label>
      <button disabled={pending} type="submit">
        {pending ? "Submitting…" : "Submit report"}
      </button>
    </form>
  );
}

function UnlockEventForm({ slug }: { slug: string }) {
  const runUnlockEvent = useServerFn(unlockEvent);
  const mutation = useEnhancedMutation(
    "We could not unlock that event. Please try again."
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

    await mutation.execute(() =>
      runUnlockEvent({
        data: {
          slug,
          password: String(form.get("password") ?? "")
        }
      })
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
      {mutation.message ? (
        <p role="alert" aria-live="polite">
          {mutation.message}
        </p>
      ) : null}
      <label>
        Event password
        <input
          name="password"
          type="password"
          autoComplete="off"
          required
          minLength={8}
          maxLength={256}
          {...fieldErrorProps(passwordErrors, "event-password-error")}
        />
        <FieldError id="event-password-error" messages={passwordErrors} />
      </label>
      <button type="submit" disabled={mutation.pending}>
        {mutation.pending ? "Unlocking…" : "Unlock event"}
      </button>
    </form>
  );
}

function RsvpEventForm({ event }: { event: EventDTO }) {
  const runRsvpEvent = useServerFn(rsvpEvent);
  const mutation = useEnhancedMutation(
    "We could not save your RSVP. Please try again."
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
        fieldErrors: { response: ["Choose yes, maybe, or no."] }
      }));
      return;
    }

    await mutation.execute(() =>
      runRsvpEvent({
        data: { slug: event.slug, response }
      })
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
      {mutation.message ? (
        <p role="alert" aria-live="polite">
          {mutation.message}
        </p>
      ) : null}
      <p>
        Current RSVP:{" "}
        <strong>
          {event.viewer_rsvp ? eventRSVPLabel(event.viewer_rsvp) : "Not set"}
        </strong>
      </p>
      {isEnded ? <p>RSVPs are closed for ended events.</p> : null}
      {isFullForViewer ? (
        <p>This event is full, but you can still choose maybe or no.</p>
      ) : null}
      <div className="rsvp-buttons">
        {(["yes", "maybe", "no"] as const).map((response) => (
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
            {eventRSVPLabel(response)}
          </button>
        ))}
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
