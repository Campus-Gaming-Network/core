import { Link, createFileRoute } from "@tanstack/react-router";
import { ChevronRight, Globe, MapPinned, School } from "lucide-react";
import { ButtonLink } from "../components/button-link";
import { useViewer } from "../components/viewer";
import { pageNoticeKey } from "../components/page-notice";
import { PageNoticeView } from "../components/page-notice-view";
import { homeAccountNotices } from "../features/account-slice/presentation";
import { SchoolMark } from "../components/school-mark";
import { EventCard } from "../features/event-slice/event-card";
import type { EventBrowseItemDTO } from "../features/event-slice/contracts";
import { loadDirectorySidebar } from "../features/account-slice/account.functions";
import { DirectorySidebar } from "../components/directory-sidebar";
import homeCSS from "../features/home-slice/home.css?url";
import { getHomeEvents } from "../features/event-slice/event.functions";
import { getHomeCatalog } from "../features/school-slice/catalog.functions";
import { getPopularGames } from "../features/popular-games/popular-games.functions";
import { PopularGamesPanel } from "../features/popular-games/popular-games-panel";
import { catalogClientStaleTime } from "../features/school-slice/contracts";
import {
  homeHead,
  schoolLocation,
} from "../features/school-slice/presentation";

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>) => {
    const account = pageNoticeKey(homeAccountNotices, search.account);
    return account ? { account } : {};
  },
  loader: async ({ context }) => {
    const [catalog, events, sidebar, popularGames] = await Promise.all([
      getHomeCatalog(),
      getHomeEvents(),
      loadDirectorySidebar(),
      getPopularGames({ data: {} }),
    ]);
    return {
      catalog,
      events,
      sidebar,
      popularGames,
      publicOrigin: context.publicOrigin,
    };
  },
  staleTime: catalogClientStaleTime,
  head: ({ loaderData }) => ({
    ...homeHead(loaderData?.publicOrigin),
    links: [{ rel: "stylesheet", href: homeCSS }],
  }),
  component: HomePage,
});

function HomePage() {
  const { catalog, events, sidebar, popularGames } = Route.useLoaderData();
  const viewer = useViewer();
  const search = Route.useSearch();
  const firstName = viewer?.name.trim().split(/\s+/)[0];
  const homeSchool =
    sidebar.status === "found" ? sidebar.homeSchool : undefined;
  const followedCount =
    sidebar.status === "found" && !sidebar.moreFollowedSchools
      ? sidebar.followedSchools.length
      : 0;

  return (
    <main
      className={
        sidebar.status === "found"
          ? "home-page layout-with-sidebar"
          : "home-page"
      }
    >
      <div className="home-main">
        <PageNoticeView
          notice={
            search.account ? homeAccountNotices[search.account] : undefined
          }
        />
        <section className="home-welcome" aria-labelledby="page-title">
          <p className="eyebrow">Campus Gaming Network</p>
          {viewer ? (
            <>
              <h1 id="page-title">Welcome back, {firstName}</h1>
              <p className="lede">
                {homeSchool
                  ? followedCount > 0
                    ? `Discover gaming events and teams at ${homeSchool.name} and the ${followedCount === 1 ? "school" : `${followedCount} schools`} you follow.`
                    : `Discover gaming events and teams at ${homeSchool.name}, or follow other schools from their pages.`
                  : "Discover gaming events and teams at your school and beyond."}
              </p>
            </>
          ) : (
            <>
              <h1 id="page-title">Find gaming events at your school</h1>
              <p className="lede">
                Tournaments, game nights, LAN parties, and teams at colleges
                across the United States, in one place.
              </p>
              <div className="actions">
                <ButtonLink variant="primary" to="/signup">
                  Create a free account
                </ButtonLink>
                <ButtonLink variant="secondary" to="/login">
                  Log in
                </ButtonLink>
              </div>
            </>
          )}
          <ul className="home-scopes" aria-label="Browse events">
            <li>
              {homeSchool ? (
                <Link
                  className="home-scope home-scope--current"
                  to="/events"
                  search={{ scope: "my-school", school: homeSchool.slug }}
                >
                  <School aria-hidden="true" size={20} strokeWidth={2} />
                  <span>
                    <strong>My school</strong>
                    <small>{homeSchool.name}</small>
                  </span>
                </Link>
              ) : (
                <Link className="home-scope" to="/schools">
                  <School aria-hidden="true" size={20} strokeWidth={2} />
                  <span>
                    <strong>Find your school</strong>
                    <small>Search every campus</small>
                  </span>
                </Link>
              )}
            </li>
            <li>
              <Link
                className="home-scope"
                to="/events"
                search={{ scope: "online", format: "online" }}
              >
                <Globe aria-hidden="true" size={20} strokeWidth={2} />
                <span>
                  <strong>Online</strong>
                  <small>Play from anywhere</small>
                </span>
              </Link>
            </li>
            <li>
              <Link className="home-scope" to="/events">
                <MapPinned aria-hidden="true" size={20} strokeWidth={2} />
                <span>
                  <strong>Nationwide</strong>
                  <small>All public events</small>
                </span>
              </Link>
            </li>
          </ul>
        </section>

        <div className="home-columns">
          <div className="home-events-column">
            <HomeEventsSection
              events={events.thisWeek}
              empty="Nothing is happening this week."
              heading="Events this week"
              id="events-this-week"
              unavailable={events.unavailable}
            />
            <HomeEventsSection
              events={events.later}
              empty="No events are planned after this week yet."
              heading="More events"
              id="more-events"
              unavailable={events.unavailable}
            />
          </div>

          <div className="home-aside">
            <section
              className="panel panel--flush"
              aria-labelledby="schools-title"
            >
              <div className="panel__header">
                <h2 id="schools-title">
                  {catalog.schoolsPopular
                    ? "Popular schools"
                    : "Start with a school"}
                </h2>
                <Link aria-label="View all schools" to="/schools">
                  View all
                </Link>
              </div>
              {catalog.schoolsUnavailable ? (
                <p className="panel__body muted">
                  School results are unavailable right now. Please try again in
                  a moment.
                </p>
              ) : catalog.schools.length > 0 ? (
                <ul className="home-schools">
                  {catalog.schools.map((school) => (
                    <li key={school.id}>
                      <Link
                        className="home-school"
                        to="/schools/$slug"
                        params={{ slug: school.slug }}
                      >
                        <SchoolMark
                          logoURL={
                            school.logo_wordmark ? undefined : school.logo_url
                          }
                          name={school.name}
                          size={40}
                          slug={school.slug}
                        />
                        <span className="home-school__copy">
                          <strong>{school.name}</strong>
                          <small>{schoolLocation(school)}</small>
                        </span>
                        <ChevronRight aria-hidden="true" size={16} />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="panel__body muted">No schools are listed yet.</p>
              )}
            </section>

            <PopularGamesPanel heading="Popular games" result={popularGames} />

            <section className="panel" aria-labelledby="host-title">
              <h2 id="host-title">Host something</h2>
              <p className="muted">
                {homeSchool
                  ? `Not seeing activity at ${homeSchool.name} yet? Create an event, or start a team to organize players around it.`
                  : "Not seeing activity for your campus yet? Create an event, or start a team to organize players around it."}
              </p>
              <div className="actions">
                <ButtonLink variant="primary" to="/events/new">
                  Create event
                </ButtonLink>
                <ButtonLink variant="secondary" to="/teams/new">
                  Create team
                </ButtonLink>
              </div>
            </section>
          </div>
        </div>
      </div>
      <DirectorySidebar sidebar={sidebar} />
    </main>
  );
}

// One of the home page's event previews: a panel of event rows with a link to
// the full list, which shows the same events in the same order.
function HomeEventsSection({
  empty,
  events,
  heading,
  id,
  unavailable,
}: {
  empty: string;
  events: EventBrowseItemDTO[];
  heading: string;
  id: string;
  unavailable: boolean;
}) {
  return (
    <section className="panel panel--flush" aria-labelledby={id}>
      <div className="panel__header">
        <h2 id={id}>{heading}</h2>
        <Link aria-label="View all events" to="/events">
          View all
        </Link>
      </div>
      {unavailable ? (
        <p className="panel__body muted">
          Events are unavailable right now. Please try again in a moment.
        </p>
      ) : events.length > 0 ? (
        <div className="list directory-list home-events">
          {events.map((event) => (
            <EventCard event={event} key={event.id} />
          ))}
        </div>
      ) : (
        <p className="panel__body muted">
          {empty} <Link to="/events/new">Create an event.</Link>
        </p>
      )}
    </section>
  );
}
