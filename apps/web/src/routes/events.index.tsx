import {
  Link,
  createFileRoute,
  type ErrorComponentProps
} from "@tanstack/react-router";
import { RouteErrorView, RoutePending } from "../components/route-boundaries";
import {
  getEventViewerSession,
  logout
} from "../features/event-slice/auth.functions";
import { EventBanner } from "../features/event-slice/event-banner";
import { getEventsBrowse } from "../features/event-slice/event.functions";
import {
  eventsBrowseInput,
  validateEventsSearch,
  type EventNotice,
  type EventsSearch
} from "../features/event-slice/contracts";
import {
  eventLifecycleLabel,
  eventLocation,
  eventNoticeMessage,
  eventTimeRange,
  eventsHead,
  isFailureNotice
} from "../features/event-slice/presentation";
import eventCSS from "../features/event-slice/events.css?url";

export const Route = createFileRoute("/events/")({
  validateSearch: validateEventsSearch,
  loaderDeps: ({ search }) => eventsBrowseInput(search),
  loader: async ({ context, deps }) => {
    const [browse, session] = await Promise.all([
      getEventsBrowse({ data: deps }),
      getEventViewerSession()
    ]);
    if (session.status === "unavailable") {
      throw new Error("Event viewer session is unavailable");
    }

    return {
      browse,
      authenticated: session.status === "authenticated",
      hasSessionCookie: session.hasSessionCookie,
      publicOrigin: context.publicOrigin
    };
  },
  staleTime: 0,
  headers: ({ loaderData }) => ({
    "cache-control": loaderData?.hasSessionCookie
      ? "private, no-store"
      : "public, max-age=0, must-revalidate",
    vary: "Cookie"
  }),
  head: ({ loaderData }) => ({
    ...eventsHead(loaderData?.publicOrigin),
    links: [{ rel: "stylesheet", href: eventCSS }]
  }),
  pendingComponent: EventsPending,
  errorComponent: EventsError,
  component: EventsPage
});

function EventsPage() {
  const { authenticated, browse } = Route.useLoaderData();
  const search = Route.useSearch();
  const previousSearch = browse.has_previous && browse.previous_cursor
    ? paginationSearch(search, { before: browse.previous_cursor })
    : undefined;
  const nextSearch = browse.has_more && browse.next_cursor
    ? paginationSearch(search, { after: browse.next_cursor })
    : undefined;
  const notice = browseNotice(search.event);

  return (
    <main className="narrow">
      <section className="page-heading">
        <p className="eyebrow">Events</p>
        <h1>Browse campus gaming events</h1>
        <p className="lede">
          Find public events by game or school. Unlisted events are available by
          direct link, and private events stay locked until unlocked.
        </p>
        {authenticated ? (
          <>
            <Link className="button button--primary" to="/events/new">
              Create event
            </Link>
            <noscript>
              <form action={logout.url} className="logout-form" method="post">
                <button type="submit">Log out</button>
              </form>
            </noscript>
          </>
        ) : (
          <Link
            className="button button--primary"
            to="/login"
            search={{ next: "/events/new" }}
          >
            Log in to create an event
          </Link>
        )}
      </section>

      {notice ? <EventNoticeView notice={notice} /> : null}

      <form action="/events" className="search-bar" method="get">
        <label>
          Game
          <select
            aria-label="Filter events by game"
            defaultValue={search.game ?? ""}
            name="game"
          >
            <option value="">All games</option>
            {browse.games.map((game) => (
              <option key={game.id} value={game.slug}>
                {game.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          School slug
          <input
            name="school"
            defaultValue={search.school}
            placeholder="university-of-california-irvine"
          />
        </label>
        <label>
          Format
          <select
            aria-label="Filter events by format"
            defaultValue={search.format ?? ""}
            name="format"
          >
            <option value="">All formats</option>
            <option value="online">Online</option>
            <option value="in_person">In person</option>
            <option value="hybrid">Hybrid</option>
          </select>
        </label>
        <button type="submit">Filter</button>
      </form>

      {browse.events.length > 0 ? (
        <div className="list">
          {browse.events.map((event) => (
            <Link
              className="card card--default list-item event-list-item"
              key={event.id}
              to="/events/$slug"
              params={{ slug: event.slug }}
            >
              <EventBanner event={event} />
              <span className="event-card-heading">
                <strong>{event.title}</strong>
                <small>{eventLifecycleLabel(event.lifecycle)}</small>
              </span>
              <small>{eventTimeRange(event)}</small>
              <small>
                {event.host_school.name} ·{" "}
                {event.games.map((game) => game.name).join(", ")}
              </small>
              <small>{eventLocation(event)}</small>
            </Link>
          ))}
        </div>
      ) : (
        <section className="empty-state">
          <h2>No public events found</h2>
          <p>Try clearing filters or create the first event for your campus.</p>
        </section>
      )}

      <nav className="pagination" aria-label="Event pages">
        {previousSearch ? (
          <Link to="/events" search={previousSearch}>
            Previous
          </Link>
        ) : (
          <span />
        )}
        <span />
        {nextSearch ? (
          <Link to="/events" search={nextSearch}>
            Next
          </Link>
        ) : (
          <span />
        )}
      </nav>
    </main>
  );
}

function paginationSearch(
  search: EventsSearch,
  cursor: Pick<EventsSearch, "after" | "before">
): EventsSearch {
  return {
    ...(search.game ? { game: search.game } : {}),
    ...(search.school ? { school: search.school } : {}),
    ...(search.format ? { format: search.format } : {}),
    ...cursor
  };
}

function browseNotice(notice: EventNotice | undefined): EventNotice | undefined {
  return notice === "cancelled" ||
    notice === "cancel-failed" ||
    notice === "deleted" ||
    notice === "failed"
    ? notice
    : undefined;
}

function EventNoticeView({ notice }: { notice: EventNotice }) {
  return (
    <p role={isFailureNotice(notice) ? "alert" : "status"} aria-live="polite">
      {eventNoticeMessage(notice)}
    </p>
  );
}

function EventsPending() {
  return <RoutePending message="Loading events…" />;
}

function EventsError({ reset }: ErrorComponentProps) {
  return (
    <RouteErrorView
      reset={reset}
      eyebrow="Events unavailable"
      heading="We could not load events."
      description="Please try again in a moment."
      showNavigation={false}
    />
  );
}
