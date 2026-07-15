import { Card } from "@heroui/react/card";
import { Chip } from "@heroui/react/chip";
import { EmptyState } from "@heroui/react/empty-state";
import Link from "next/link";
import { schoolLocation } from "../lib/cgn-api";
import { listGames, listSchools } from "../lib/server-api";

export default async function HomePage() {
  const [schools, games] = await Promise.all([
    listSchools({ limit: 6 }).catch(() => ({ schools: [] })),
    listGames().catch(() => [])
  ]);

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
            <Link className="button button--primary" href="/schools">
              Browse schools
            </Link>
            <Link className="button button--secondary" href="/events">
              Browse events
            </Link>
            <Link className="button button--secondary" href="/signup">
              Create account
            </Link>
          </div>
        </div>
        <Card className="feature-board" aria-label="Launch games">
          <p className="board-kicker">Launch games</p>
          <div className="game-grid">
            {games.length > 0 ? (
              games.map((game) => <Chip key={game.id}>{game.name}</Chip>)
            ) : (
              <Chip>Games will appear when the API is available.</Chip>
            )}
          </div>
        </Card>
      </section>

      <section className="section" aria-labelledby="schools-title">
        <div className="section-heading">
          <p className="eyebrow">School discovery</p>
          <h2 id="schools-title">Start with a campus.</h2>
          <Link className="link" href="/schools">Search all schools</Link>
        </div>
        {schools.schools.length > 0 ? (
          <div className="card-grid">
            {schools.schools.map((school) => (
              <Link className="card card--default school-card" href={`/schools/${school.slug}`} key={school.id}>
                <span>{school.name}</span>
                <small>{schoolLocation(school)}</small>
              </Link>
            ))}
          </div>
        ) : (
          <EmptyState>
            School results are unavailable right now. The API may still be
            starting.
          </EmptyState>
        )}
      </section>

      <Card className="section action-panel" aria-labelledby="cold-start-title">
        <p className="eyebrow">Start the scene</p>
        <h2 id="cold-start-title">Not seeing activity for your campus yet?</h2>
        <p>
          CGN works even before the calendar fills up: create the first event,
          start a team, or follow your school so new activity lands on your
          dashboard.
        </p>
        <div className="actions">
          <Link className="button button--primary" href="/events/new">
            Create first event
          </Link>
          <Link className="button button--secondary" href="/teams/new">
            Start a team
          </Link>
          <Link className="button button--secondary" href="/schools">
            Follow a school
          </Link>
        </div>
      </Card>
    </main>
  );
}
