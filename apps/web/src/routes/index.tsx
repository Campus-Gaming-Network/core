import { Link, createFileRoute } from "@tanstack/react-router";
import { ButtonLink } from "../components/button-link";
import { useViewer } from "../components/viewer";
import { pageNoticeKey } from "../components/page-notice";
import { PageNoticeView } from "../components/page-notice-view";
import { homeAccountNotices } from "../features/account-slice/presentation";
import { SchoolLogo } from "../components/school-logo";
import { EventCard } from "../features/event-slice/event-card";
import { getHomeEvents } from "../features/event-slice/event.functions";
import { getHomeCatalog } from "../features/school-slice/catalog.functions";
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
    const [catalog, events] = await Promise.all([
      getHomeCatalog(),
      getHomeEvents(),
    ]);
    return { catalog, events, publicOrigin: context.publicOrigin };
  },
  staleTime: catalogClientStaleTime,
  head: ({ loaderData }) => homeHead(loaderData?.publicOrigin),
  component: HomePage,
});

function HomePage() {
  const { catalog, events } = Route.useLoaderData();
  const viewer = useViewer();
  const search = Route.useSearch();

  return (
    <main className="home-page">
      <PageNoticeView
        notice={search.account ? homeAccountNotices[search.account] : undefined}
      />
      <section className="hero" aria-labelledby="page-title">
        <div className="hero-copy">
          <p className="eyebrow">Your campus is playing</p>
          <h1 id="page-title">Find your next game night.</h1>
          <p className="lede">
            Discover tournaments, casual meetups, and teams at schools near you.
            Everything you need to show up and play is in one place.
          </p>
          <div className="actions">
            <ButtonLink variant="primary" to="/events">
              Explore events
            </ButtonLink>
            <ButtonLink variant="secondary" to="/schools">
              Find your school
            </ButtonLink>
          </div>
          {viewer === null ? (
            <p className="hero-note">
              New here? <Link to="/signup">Create a free account</Link> to RSVP
              and follow your campus.
            </p>
          ) : null}
        </div>
      </section>

      <section className="section" aria-labelledby="events-title">
        <div className="section-heading">
          <h2 id="events-title">Events around campus</h2>
          <Link to="/events">Browse all events</Link>
        </div>
        {events.unavailable ? (
          <p className="empty-state">
            Events are unavailable right now. The API may still be starting.
          </p>
        ) : events.events.length > 0 ? (
          <div className="list">
            {events.events.map((event) => (
              <EventCard event={event} key={event.id} />
            ))}
          </div>
        ) : (
          <p className="empty-state">
            No public events yet.{" "}
            <Link to="/events/new">Create the first one.</Link>
          </p>
        )}
      </section>

      <section className="section" aria-labelledby="schools-title">
        <div className="section-heading">
          <h2 id="schools-title">
            {catalog.schoolsPopular
              ? "Popular campuses"
              : "Start with a campus."}
          </h2>
          <Link to="/schools">Search all schools</Link>
        </div>
        {catalog.schoolsUnavailable ? (
          <p className="empty-state">
            School results are unavailable right now. The API may still be
            starting.
          </p>
        ) : catalog.schools.length > 0 ? (
          <div className="card-grid">
            {catalog.schools.map((school) => (
              <Link
                className="card card--default school-card"
                key={school.id}
                to="/schools/$slug"
                params={{ slug: school.slug }}
              >
                <span aria-hidden="true" className="school-directory-mark">
                  {school.name.slice(0, 1).toUpperCase()}
                  <SchoolLogo logoURL={school.logo_url} size={44} />
                </span>
                <span>{school.name}</span>
                <small>{schoolLocation(school)}</small>
              </Link>
            ))}
          </div>
        ) : (
          <p className="empty-state">No schools are listed yet.</p>
        )}
      </section>

      <section className="section" aria-labelledby="how-it-works-title">
        <div className="section-heading">
          <h2 id="how-it-works-title">How it works</h2>
        </div>
        <ol className="steps">
          <li className="card step">
            <h3>Find your school</h3>
            <p>
              Search the directory and follow your campus to see its events and
              teams.
            </p>
          </li>
          <li className="card step">
            <h3>Browse events</h3>
            <p>
              Filter by game or format. Public events are open to everyone;
              private ones unlock with a password.
            </p>
          </li>
          <li className="card step">
            <h3>RSVP</h3>
            <p>
              Say yes, maybe, or no. A yes RSVP gets a confirmation email with a
              calendar file.
            </p>
          </li>
          <li className="card step">
            <h3>Start a team</h3>
            <p>
              Create a team for your school, pick your games, and share a join
              password with members.
            </p>
          </li>
        </ol>
      </section>

      <section className="action-panel" aria-labelledby="cold-start-title">
        <p className="eyebrow">Start the scene</p>
        <h2 id="cold-start-title">Not seeing activity for your campus yet?</h2>
        <p>
          The calendar fills up when someone hosts the first event. Create one
          for your campus, or start a team to organize players around it.
        </p>
        <div className="actions">
          <ButtonLink variant="primary" to="/events/new">
            Create an event
          </ButtonLink>
          <Link className="link" to="/teams/new">
            Or start a team
          </Link>
        </div>
      </section>
    </main>
  );
}
