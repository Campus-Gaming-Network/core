import {
  createFileRoute,
  notFound,
  type ErrorComponentProps
} from "@tanstack/react-router";
import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import {
  getEventDetail,
  rsvpEvent,
  unlockEvent
} from "../features/event-slice/event.functions";
import type {
  EventDTO,
  EventDetailDTO,
  LockedEventDTO
} from "../features/event-slice/contracts";

const siteName = "Campus Gaming Network";
const privateEventDescription =
  "This event is private. Enter the password to view it.";

export type EventRouteData = {
  event: EventDetailDTO;
  authenticated: boolean;
  publicOrigin: string;
};

type EventSearch = {
  event?:
    | "rsvp-failed"
    | "rsvp-updated"
    | "unlock-failed"
    | "unlocked";
};

export const Route = createFileRoute("/events/$slug")({
  validateSearch: validateEventSearch,
  loader: async ({ context, params }): Promise<EventRouteData> => {
    // Cookie forwarding, upstream validation, and private-event access checks
    // stay behind these server functions. The loader only consumes their safe
    // serializable DTOs.
    const detail = await getEventDetail({ data: { slug: params.slug } });
    const session = context.viewerSession;

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
  head: ({ loaderData }) => eventHead(loaderData),
  pendingComponent: EventPending,
  errorComponent: EventError,
  component: EventPage
});

export function validateEventSearch(search: Record<string, unknown>): EventSearch {
  const event = firstString(search.event);

  return event === "rsvp-failed" ||
    event === "rsvp-updated" ||
    event === "unlock-failed" ||
    event === "unlocked"
    ? { event }
    : {};
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
      <section className="page-heading">
        <p className="eyebrow">Private event</p>
        <h1>This event is private.</h1>
        <p className="lede">
          Enter the event password to reveal the details. Nothing private is
          sent to the browser until the password checks out.
        </p>
      </section>
      <UnlockEventForm slug={slug} />
      <div className="actions">
        <a className="button button--secondary" href="/events">
          Browse public events
        </a>
        {authenticated ? null : (
          <a
            className="button button--primary"
            href={`/login?next=${encodeURIComponent(`/events/${slug}`)}`}
          >
            Log in
          </a>
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
  return (
    <main className="narrow">
      <section className="page-heading">
        <p className="eyebrow">Event</p>
        <h1>{event.title}</h1>
        <p className="lede">
          {event.description || "Event details are coming soon."}
        </p>
        <p>
          {label(event.lifecycle)} · {label(event.visibility)} · {label(event.format)}
        </p>
      </section>

      {notice ? (
        <p
          role={notice.endsWith("-failed") ? "alert" : "status"}
          aria-live="polite"
        >
          {eventNotice(notice)}
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
            <a href={`/schools/${event.host_school.slug}`}>
              {event.host_school.name}
            </a>
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
              {recurrenceLabel(event.recurrence_rule)} until{" "}
              {formatDate(event.recurrence_until, event.timezone)}
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
              {event.payment_url ? (
                <>
                  {" "}
                  <a href={event.payment_url}>Payment link</a>
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
                <a href={`/users/${organizer.id}`}>{organizer.name}</a>
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
          <RsvpEventForm event={event} />
        ) : (
          <a
            className="button button--primary"
            href={`/login?next=${encodeURIComponent(`/events/${event.slug}`)}`}
          >
            Log in to RSVP
          </a>
        )}
      </section>
    </main>
  );
}

function UnlockEventForm({ slug }: { slug: string }) {
  const runUnlockEvent = useServerFn(unlockEvent);
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setFailed(false);

    try {
      const form = new FormData(event.currentTarget);
      const result = await runUnlockEvent({
        data: {
          slug,
          password: String(form.get("password") ?? "")
        }
      });

      if (result.status !== "success") {
        setFailed(true);
        return;
      }

      await router.invalidate();
      await router.navigate({ href: result.redirectTo, replace: true });
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      action={unlockEvent.url}
      className="inline-form private-unlock-form"
      method="post"
      onSubmit={submit}
    >
      <input type="hidden" name="slug" value={slug} />
      {failed ? (
        <p role="alert" aria-live="polite">
          That password did not unlock the event. Try again.
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
          aria-invalid={failed || undefined}
        />
      </label>
      <button type="submit" disabled={pending}>
        {pending ? "Unlocking…" : "Unlock event"}
      </button>
    </form>
  );
}

function RsvpEventForm({ event }: { event: EventDTO }) {
  const runRsvpEvent = useServerFn(rsvpEvent);
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const isEnded = event.lifecycle === "ended";
  const isFullForViewer =
    event.lifecycle === "full" && event.viewer_rsvp !== "yes";

  async function submit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    const submitter = (formEvent.nativeEvent as SubmitEvent)
      .submitter as HTMLButtonElement | null;
    const response = submitter?.value;

    if (response !== "yes" && response !== "maybe" && response !== "no") {
      setFailed(true);
      return;
    }

    setPending(true);
    setFailed(false);

    try {
      const result = await runRsvpEvent({
        data: { slug: event.slug, response }
      });

      if (result.status !== "success") {
        setFailed(true);
        return;
      }

      await router.invalidate();
      await router.navigate({ href: result.redirectTo, replace: true });
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      action={rsvpEvent.url}
      className="rsvp-form"
      method="post"
      onSubmit={submit}
    >
      <input type="hidden" name="slug" value={event.slug} />
      {failed ? (
        <p role="alert" aria-live="polite">
          We could not save your RSVP. Please try again.
        </p>
      ) : null}
      <p>
        Current RSVP:{" "}
        <strong>{event.viewer_rsvp ? label(event.viewer_rsvp) : "Not set"}</strong>
      </p>
      {isEnded ? <p>RSVPs are closed for ended events.</p> : null}
      {isFullForViewer ? (
        <p>This event is full, but you can still choose maybe or no.</p>
      ) : null}
      <div className="rsvp-buttons">
        {(["yes", "maybe", "no"] as const).map((response) => (
          <button
            aria-pressed={event.viewer_rsvp === response}
            disabled={
              pending ||
              isEnded ||
              (response === "yes" && isFullForViewer)
            }
            key={response}
            name="response"
            type="submit"
            value={response}
          >
            {label(response)}
          </button>
        ))}
      </div>
    </form>
  );
}

function EventPending() {
  return (
    <main className="narrow" aria-busy="true" aria-live="polite">
      <p>Loading event…</p>
    </main>
  );
}

function EventError({ reset }: ErrorComponentProps) {
  const router = useRouter();

  async function retry() {
    try {
      await router.invalidate();
    } finally {
      reset();
    }
  }

  return (
    <main className="narrow">
      <p className="eyebrow">Event unavailable</p>
      <h1>We could not load this event.</h1>
      <p className="lede">Please try again in a moment.</p>
      <button type="button" onClick={() => void retry()}>
        Try again
      </button>
    </main>
  );
}

function isLockedEvent(event: EventDetailDTO): event is LockedEventDTO {
  return "locked" in event && event.locked === true;
}

function eventTimeRange(event: EventDTO) {
  const options: Intl.DateTimeFormatOptions = {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: event.timezone
  };
  const formatter = new Intl.DateTimeFormat("en-US", options);

  return `${formatter.format(new Date(event.starts_at))} – ${formatter.format(new Date(event.ends_at))}`;
}

function eventLocation(event: EventDTO) {
  if (event.format === "online") {
    return event.online_url ? "Online" : "Online details pending";
  }

  const place = [event.location_name, event.address].filter(Boolean).join(" · ");

  if (event.format === "hybrid") {
    return place ? `${place} + online` : "Hybrid details pending";
  }

  return place || "Location pending";
}

function formatDate(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone
  }).format(new Date(value));
}

function recurrenceLabel(value: NonNullable<EventDTO["recurrence_rule"]>) {
  const labels = {
    biweekly: "Every two weeks",
    monthly: "Monthly",
    weekly: "Weekly"
  } as const;

  return labels[value];
}

function label(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/^./, (first) => first.toUpperCase());
}

function verificationLabel(level: string) {
  const labels: Record<string, string> = {
    basic: "Community member",
    verified: "Verified student",
    staff_faculty: "Staff / faculty"
  };

  return labels[level] ?? "Community member";
}

function roleIndicatorLabel(role: string) {
  const labels: Record<string, string> = {
    school_admin: "School admin",
    staff_faculty: "Staff / faculty"
  };

  return labels[role] ?? "Community role";
}

function eventNotice(notice: NonNullable<EventSearch["event"]>) {
  const notices = {
    "rsvp-failed": "We could not save your RSVP. Please try again.",
    "rsvp-updated": "RSVP saved.",
    "unlock-failed": "That password did not unlock the event. Try again.",
    unlocked: "Event unlocked."
  } as const;

  return notices[notice];
}

function firstString(value: unknown) {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value) && typeof value[0] === "string") {
    return value[0];
  }

  return undefined;
}
