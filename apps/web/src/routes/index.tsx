import { Link, createFileRoute } from "@tanstack/react-router";
import { getHomeCatalog } from "../features/school-slice/catalog.functions";
import { catalogClientStaleTime } from "../features/school-slice/contracts";
import {
  homeHead,
  schoolLocation
} from "../features/school-slice/presentation";

export const Route = createFileRoute("/")({
  loader: async ({ context }) => ({
    catalog: await getHomeCatalog(),
    publicOrigin: context.publicOrigin
  }),
  staleTime: catalogClientStaleTime,
  head: ({ loaderData }) => homeHead(loaderData?.publicOrigin),
  component: HomePage
});

function HomePage() {
  const { catalog } = Route.useLoaderData();

  return (
    <main>
      <section className="hero" aria-labelledby="page-title">
        <div className="hero-copy">
          <p className="eyebrow">Campus Gaming Network</p>
          <h1 id="page-title">Find the campus gaming scene around you.</h1>
          <p className="lede">
            Browse schools, choose your home campus, and start following the
            places where collegiate gaming events are taking shape.
          </p>
          <div className="actions">
            <Link className="button button--primary" to="/schools">
              Browse schools
            </Link>
            <Link className="button button--secondary" to="/events">
              Browse events
            </Link>
            <Link className="button button--secondary" to="/signup">
              Create account
            </Link>
          </div>
        </div>
        <section className="feature-board" aria-label="Launch games">
          <p className="board-kicker">Launch games</p>
          <div className="game-grid">
            {catalog.games.length > 0 ? (
              catalog.games.map((game) => (
                <span className="chip" key={game.id}>{game.name}</span>
              ))
            ) : (
              <span className="chip">
                Games will appear when the API is available.
              </span>
            )}
          </div>
        </section>
      </section>

      <section className="section" aria-labelledby="schools-title">
        <div className="section-heading">
          <p className="eyebrow">School discovery</p>
          <h2 id="schools-title">Start with a campus.</h2>
          <Link to="/schools">Search all schools</Link>
        </div>
        {catalog.schools.length > 0 ? (
          <div className="card-grid">
            {catalog.schools.map((school) => (
              <Link
                className="card card--default school-card"
                key={school.id}
                to="/schools/$slug"
                params={{ slug: school.slug }}
              >
                <span>{school.name}</span>
                <small>{schoolLocation(school)}</small>
              </Link>
            ))}
          </div>
        ) : (
          <p className="empty-state">
            School results are unavailable right now. The API may still be
            starting.
          </p>
        )}
      </section>

      <section className="section action-panel" aria-labelledby="cold-start-title">
        <p className="eyebrow">Start the scene</p>
        <h2 id="cold-start-title">Not seeing activity for your campus yet?</h2>
        <p>
          CGN works even before the calendar fills up: create the first event,
          start a team, or follow your school so new activity lands on your
          dashboard.
        </p>
        <div className="actions">
          <Link className="button button--primary" to="/events/new">
            Create first event
          </Link>
          <Link className="button button--secondary" to="/teams/new">
            Start a team
          </Link>
          <Link className="button button--secondary" to="/schools">
            Follow a school
          </Link>
        </div>
      </section>
    </main>
  );
}
