import {
  Link,
  createFileRoute,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { ButtonLink } from "../components/button-link";
import {
  ListUnavailable,
  RouteErrorView,
  RoutePending,
} from "../components/route-boundaries";
import { PageNoticeView } from "../components/page-notice-view";
import { getEventViewerSession } from "../features/event-slice/auth.functions";
import { EventCard } from "../features/event-slice/event-card";
import { getEventsBrowse } from "../features/event-slice/event.functions";
import {
  eventsBrowseInput,
  validateEventsSearch,
  type EventsSearch,
} from "../features/event-slice/contracts";
import {
  eventAudienceLabels,
  eventBrowseNotices,
  eventsHead,
} from "../features/event-slice/presentation";

export const Route = createFileRoute("/events/")({
  validateSearch: validateEventsSearch,
  loaderDeps: ({ search }) => eventsBrowseInput(search),
  loader: async ({ context, deps }) => {
    const [browse, session] = await Promise.all([
      getEventsBrowse({ data: deps }),
      getEventViewerSession(),
    ]);
    if (session.status === "unavailable") {
      throw new Error("Event viewer session is unavailable");
    }

    return {
      browse,
      authenticated: session.status === "authenticated",
      hasSessionCookie: session.hasSessionCookie,
      publicOrigin: context.publicOrigin,
    };
  },
  staleTime: 0,
  headers: ({ loaderData }) => ({
    "cache-control": loaderData?.hasSessionCookie
      ? "private, no-store"
      : "public, max-age=0, must-revalidate",
    vary: "Cookie",
  }),
  head: ({ loaderData }) => eventsHead(loaderData?.publicOrigin),
  pendingComponent: EventsPending,
  errorComponent: EventsError,
  component: EventsPage,
});

function EventsPage() {
  const { authenticated, browse } = Route.useLoaderData();
  const search = Route.useSearch();
  const previousSearch =
    browse.has_previous && browse.previous_cursor
      ? paginationSearch(search, { before: browse.previous_cursor })
      : undefined;
  const nextSearch =
    browse.has_more && browse.next_cursor
      ? paginationSearch(search, { after: browse.next_cursor })
      : undefined;

  return (
    <main className="browse-page">
      <section className="page-heading">
        <p className="eyebrow">Events</p>
        <h1>Browse campus gaming events</h1>
        <p className="lede">
          Find public events by game or school. Unlisted events are available by
          direct link, and private events stay locked until unlocked.
        </p>
        {authenticated ? (
          <ButtonLink variant="primary" to="/events/new">
            Create event
          </ButtonLink>
        ) : (
          <ButtonLink
            variant="primary"
            to="/login"
            search={{ next: "/events/new" }}
          >
            Log in to create an event
          </ButtonLink>
        )}
      </section>

      <PageNoticeView
        notice={search.event ? eventBrowseNotices[search.event] : undefined}
      />

      <form action="/events" className="search-bar" method="get">
        {search.school ? (
          <input name="school" type="hidden" value={search.school} />
        ) : null}
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
          {browse.gamesUnavailable ? (
            <small>Game filters are unavailable right now.</small>
          ) : null}
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
        <label>
          Audience
          <select
            aria-label="Filter events by audience"
            defaultValue={search.audience ?? ""}
            name="audience"
          >
            <option value="">All audiences</option>
            {Object.entries(eventAudienceLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit">Filter</button>
      </form>

      {browse.eventsUnavailable ? (
        <ListUnavailable heading="Events are unavailable right now" />
      ) : browse.events.length > 0 ? (
        <div className="list">
          {browse.events.map((event) => (
            <EventCard event={event} key={event.id} />
          ))}
        </div>
      ) : (
        <section className="empty-state">
          <h2>No public events found</h2>
          <p>Try clearing filters or create the first event for your campus.</p>
        </section>
      )}

      {previousSearch || nextSearch ? (
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
      ) : null}
    </main>
  );
}

function paginationSearch(
  search: EventsSearch,
  cursor: Pick<EventsSearch, "after" | "before">,
): EventsSearch {
  return {
    ...(search.game ? { game: search.game } : {}),
    ...(search.school ? { school: search.school } : {}),
    ...(search.format ? { format: search.format } : {}),
    ...(search.audience ? { audience: search.audience } : {}),
    ...cursor,
  };
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
