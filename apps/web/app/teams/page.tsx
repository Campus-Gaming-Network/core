import Link from "next/link";
import { currentProfile, listGames, listTeams } from "../../lib/server-api";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function TeamsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const game = param(params.game);
  const school = param(params.school);
  const [profile, games, result] = await Promise.all([
    currentProfile(),
    listGames().catch(() => []),
    listTeams({ game, school, limit: 25 }).catch(() => ({
      teams: [],
      limit: 25,
      offset: 0
    }))
  ]);

  return (
    <main className="narrow">
      <section className="page-heading">
        <p className="eyebrow">Teams</p>
        <h1>Find campus gaming teams</h1>
        <p className="lede">
          Team pages are public. Join with a team password, then owners can
          assign captains or transfer ownership.
        </p>
        <div className="actions">
          {profile ? (
            <Link className="button primary" href="/teams/new">
              Create team
            </Link>
          ) : (
            <Link className="button primary" href="/login?next=/teams/new">
              Log in to create
            </Link>
          )}
        </div>
      </section>

      <form action="/teams" className="search-bar">
        <label>
          Game
          <select name="game" defaultValue={game}>
            <option value="">All games</option>
            {games.map((gameOption) => (
              <option key={gameOption.id} value={gameOption.slug}>
                {gameOption.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          School slug
          <input
            name="school"
            defaultValue={school}
            placeholder="university-of-california-irvine"
          />
        </label>
        <button type="submit">Filter</button>
      </form>

      {result.teams.length > 0 ? (
        <div className="list">
          {result.teams.map((team) => (
            <Link className="list-item block" href={`/teams/${team.slug}`} key={team.id}>
              <span className="event-card-heading">
                <strong>{team.name}</strong>
                <small>{team.member_count} member{team.member_count === 1 ? "" : "s"}</small>
              </span>
              <small>{team.games.map((game) => game.name).join(", ")}</small>
              <small>{team.school?.name ?? "Independent team"}</small>
            </Link>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <h2>No teams found</h2>
          <p>
            Try clearing filters or create the first team for your campus.
          </p>
        </div>
      )}
    </main>
  );
}

function param(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}
