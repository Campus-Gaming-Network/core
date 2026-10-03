import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { ButtonLink } from "../components/button-link";
import { PageNoticeView } from "../components/page-notice-view";
import { ListUnavailable, RoutePending } from "../components/route-boundaries";
import {
  NoScriptSchoolSearch,
  SchoolSearchSelect,
} from "../components/school-search-select";
import { getEventViewerSession } from "../features/event-slice/auth.functions";
import {
  teamsBrowsePageInput,
  validateTeamsSearch,
  type TeamsSearch,
} from "../features/team-slice/contracts";
import { getTeamsBrowsePage } from "../features/team-slice/team.functions";
import {
  teamBrowseNotices,
  teamsHead,
} from "../features/team-slice/presentation";
import teamCSS from "../features/team-slice/teams.css?url";

export const Route = createFileRoute("/teams/")({
  validateSearch: validateTeamsSearch,
  loaderDeps: ({ search }) => teamsBrowsePageInput(search),
  loader: async ({ context, deps }) => {
    const [catalog, session] = await Promise.all([
      getTeamsBrowsePage({ data: deps }),
      getEventViewerSession(),
    ]);
    if (session.status === "unavailable") {
      throw new Error("Team viewer session is unavailable");
    }
    return {
      catalog,
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
  head: ({ loaderData }) => ({
    ...teamsHead(loaderData?.publicOrigin),
    links: [{ rel: "stylesheet", href: teamCSS }],
  }),
  pendingComponent: TeamsPending,
  component: TeamsPage,
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
  // A school the catalog cannot name still shows as a filter that can be cleared.
  const filteredSchool = search.school
    ? (catalog.selectedSchool ?? {
        id: search.school,
        name: "Selected school",
        slug: search.school,
      })
    : undefined;

  return (
    <main className="browse-page">
      <section className="page-heading browse-heading">
        <p className="eyebrow">Teams</p>
        <h1>Find campus gaming teams</h1>
        <p className="lede">
          Team pages are public. Joining uses a team password, and owners can
          assign captains or transfer ownership.
        </p>
        <div className="actions">
          {authenticated ? (
            <ButtonLink variant="primary" to="/teams/new">
              Create a team
            </ButtonLink>
          ) : (
            <>
              <ButtonLink
                variant="primary"
                to="/login"
                search={{ next: "/teams/new" }}
              >
                Log in to create a team
              </ButtonLink>
            </>
          )}
        </div>
      </section>

      <PageNoticeView
        notice={search.team ? teamBrowseNotices[search.team] : undefined}
      />

      <NoScriptSchoolSearch
        action="/teams"
        preserve={{ game: search.game, school: search.school }}
        query={search.school_q ?? ""}
      />
      <form action="/teams" className="search-bar team-filter-bar" method="get">
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
          {catalog.gamesUnavailable ? (
            <small>Game filters are unavailable right now.</small>
          ) : null}
        </label>
        <SchoolSearchSelect
          className="team-school-filter"
          defaultSchool={filteredSchool}
          defaultValue={search.school ?? ""}
          emptyLabel="All schools"
          initialQuery={search.school_q ?? ""}
          initialSchools={catalog.schools}
          initialSearchFailed={catalog.schoolSearchFailed}
          key={search.school ?? ""}
          label="School"
          name="school"
          valueField="slug"
        />
        <button type="submit">Filter</button>
        {filteredSchool ? (
          <p className="team-active-filter">
            <span>
              Showing teams from <strong>{filteredSchool.name}</strong>
            </span>
            <Link to="/teams" search={search.game ? { game: search.game } : {}}>
              Clear school filter
            </Link>
          </p>
        ) : null}
      </form>

      {catalog.teamsUnavailable ? (
        <ListUnavailable heading="Teams are unavailable right now" />
      ) : catalog.teams.length > 0 ? (
        <div className="list discovery-list">
          {catalog.teams.map((team) => (
            <Link
              className="card card--default list-item team-discovery-row"
              key={team.id}
              to="/teams/$slug"
              params={{ slug: team.slug }}
            >
              <span aria-hidden="true" className="team-mark">
                {team.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="team-discovery-copy">
                <strong>{team.name}</strong>
                <small>{team.games.map((game) => game.name).join(", ")}</small>
                <small>{team.school?.name ?? "Independent team"}</small>
              </span>
              <span className="team-member-count">
                {team.member_count} member{team.member_count === 1 ? "" : "s"}
              </span>
              <span className="discovery-row__action with-arrow">
                View team
                <ArrowRight aria-hidden="true" size={14} strokeWidth={2.25} />
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <section className="empty-state">
          <h2>No teams found</h2>
          <p>
            Try clearing filters or check again when more teams are available.
          </p>
        </section>
      )}

      {previousSearch || nextSearch ? (
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
      ) : null}
    </main>
  );
}

export function paginationSearch(
  search: TeamsSearch,
  cursor: Pick<TeamsSearch, "after" | "before">,
): TeamsSearch {
  return {
    ...(search.game ? { game: search.game } : {}),
    ...(search.school ? { school: search.school } : {}),
    ...cursor,
  };
}

function TeamsPending() {
  return <RoutePending message="Loading teams…" />;
}
