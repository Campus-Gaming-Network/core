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
            places where collegiate gaming is taking shape.
          </p>
          <div className="actions">
            <Link className="button primary" href="/schools">
              Browse schools
            </Link>
            <Link className="button" href="/signup">
              Create account
            </Link>
          </div>
        </div>
        <div className="feature-board" aria-label="Launch games">
          <p className="board-kicker">Launch games</p>
          <div className="game-grid">
            {games.length > 0 ? (
              games.map((game) => <span key={game.id}>{game.name}</span>)
            ) : (
              <span>Games will appear when the API is available.</span>
            )}
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="schools-title">
        <div className="section-heading">
          <p className="eyebrow">School discovery</p>
          <h2 id="schools-title">Start with a campus.</h2>
          <Link href="/schools">Search all schools</Link>
        </div>
        {schools.schools.length > 0 ? (
          <div className="card-grid">
            {schools.schools.map((school) => (
              <Link className="school-card" href={`/schools/${school.slug}`} key={school.id}>
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
    </main>
  );
}
