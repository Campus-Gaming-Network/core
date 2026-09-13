import { Link, createFileRoute } from "@tanstack/react-router";
import { RoutePending } from "../components/route-boundaries";
import { getEventViewerSession } from "../features/event-slice/auth.functions";
import {
  teamsBrowseInput,
  validateTeamsSearch,
  type TeamsSearch
} from "../features/team-slice/contracts";
import { getTeamsBrowse } from "../features/team-slice/team.functions";
import { teamsHead } from "../features/team-slice/presentation";
import teamCSS from "../features/team-slice/teams.css?url";

export const Route = createFileRoute("/teams/")({
  validateSearch: validateTeamsSearch,
  loaderDeps: ({ search }) => teamsBrowseInput(search),
  loader: async ({ context, deps }) => {
    const [catalog, session] = await Promise.all([
      getTeamsBrowse({ data: deps }),
      getEventViewerSession()
    ]);
    if (session.status === "unavailable") {
      throw new Error("Team viewer session is unavailable");
    }
    return {
      catalog,
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
    ...teamsHead(loaderData?.publicOrigin),
    links: [{ rel: "stylesheet", href: teamCSS }]
  }),
  pendingComponent: TeamsPending,
  component: TeamsPage
});

function TeamsPage() {
  const { authenticated, catalog } = Route.useLoaderData();
  const search = Route.useSearch();
  const previousSearch =
    catalog.has_previous && catalog.previous_cursor
      ? paginationSearch(search, { before: catalog.previous_cursor })
      : undefined;
  const nextSearch =
    catalog.has_more && catalog.next_cursor
      ? paginationSearch(search, { after: catalog.next_cursor })
      : undefined;

  return (
    <main className="narrow">
      <section className="page-heading">
        <p className="eyebrow">Teams</p>
        <h1>Find campus gaming teams</h1>
        <p className="lede">
          Team pages are public. Joining uses a team password, and owners can
          assign captains or transfer ownership.
        </p>
        <div className="actions">
          {authenticated ? (
            <Link className="button button--primary" to="/teams/new">
              Create a team
            </Link>
          ) : (
            <>
              <Link
                className="button button--primary"
                to="/login"
                search={{ next: "/teams/new" }}
              >
                Log in to create a team
              </Link>
            </>
          )}
        </div>
      </section>

      <form action="/teams" className="search-bar" method="get">
        <label>
          Game
          <select
            name="game"
            defaultValue={search.game}
            aria-label="Filter teams by game"
          >
            <option value="">All games</option>
            {catalog.games.map((game) => (
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
        <button type="submit">Filter</button>
      </form>

      {catalog.teams.length > 0 ? (
        <div className="list">
          {catalog.teams.map((team) => (
            <Link
              className="card card--default list-item block"
              key={team.id}
              to="/teams/$slug"
              params={{ slug: team.slug }}
            >
              <span className="event-card-heading">
                <strong>{team.name}</strong>
                <small>
                  {team.member_count} member{team.member_count === 1 ? "" : "s"}
                </small>
              </span>
              <small>{team.games.map((game) => game.name).join(", ")}</small>
              <small>{team.school?.name ?? "Independent team"}</small>
            </Link>
          ))}
        </div>
      ) : (
        <section className="empty-state">
          <h2>No teams found</h2>
          <p>Try clearing filters or check again when more teams are available.</p>
        </section>
      )}

      <nav className="pagination" aria-label="Team pages">
        {previousSearch ? (
          <Link to="/teams" search={previousSearch}>
            Previous
          </Link>
        ) : (
          <span />
        )}
        {nextSearch ? (
          <Link to="/teams" search={nextSearch}>
            Next
          </Link>
        ) : (
          <span />
        )}
      </nav>
    </main>
  );
}

export function paginationSearch(
  search: TeamsSearch,
  cursor: Pick<TeamsSearch, "after" | "before">
): TeamsSearch {
  return {
    ...(search.game ? { game: search.game } : {}),
    ...(search.school ? { school: search.school } : {}),
    ...cursor
  };
}

function TeamsPending() {
  return <RoutePending message="Loading teams…" />;
}
