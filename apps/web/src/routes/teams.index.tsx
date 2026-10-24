import {
  DirectoryResults,
  useDirectoryResults,
} from "../components/directory-results";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, Users } from "lucide-react";
import { ButtonLink } from "../components/button-link";
import {
  DirectoryRow,
  directoryRowClassName,
} from "../components/directory-row";
import {
  ClearFiltersLink,
  FilterForm,
  FilterToolbar,
  NoScriptFilterSearch,
  ResultsAnnouncement,
} from "../components/filter-toolbar";
import {
  activeFilterChips,
  mostRestrictiveChip,
  resultsAnnouncement,
  type AppliedFilter,
} from "../components/directory-filters";
import { PageNoticeView } from "../components/page-notice-view";
import { ListUnavailable, RoutePending } from "../components/route-boundaries";
import {
  SearchFilter,
  searchFilterFallback,
} from "../components/search-filter";
import {
  gameFilterOption,
  searchGameFilter,
} from "../features/game-picker/game-filter-options";
import {
  schoolFilterOption,
  searchSchoolFilter,
} from "../features/school-slice/school-filter-options";
import { getEventViewerSession } from "../features/event-slice/auth.functions";
import { EventGameThumb } from "../features/event-slice/event-game-thumb";
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
import { PageIntro } from "../components/page-heading";
import { Surface } from "../components/surface";

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
  head: ({ loaderData }) => {
    const head = teamsHead(loaderData?.publicOrigin);
    return {
      ...head,
      links: [...head.links, { rel: "stylesheet", href: teamCSS }],
    };
  },
  pendingComponent: TeamsPending,
  component: TeamsPage,
});

function TeamsPage() {
  const { busy, onPaginate, resultsRef } = useDirectoryResults();
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
  // A school or game the catalog cannot name still shows as a filter that
  // can be cleared.
  const filteredSchool = search.school
    ? (catalog.selectedSchool ?? {
        id: search.school,
        name: "Selected school",
        slug: search.school,
      })
    : undefined;
  const filteredGame = search.game
    ? (catalog.selectedGame ?? {
        id: search.game,
        name: "Selected game",
        slug: search.game,
      })
    : undefined;
  const chosenSchool = filteredSchool
    ? schoolFilterOption(filteredSchool)
    : undefined;
  const chosenGame = filteredGame ? gameFilterOption(filteredGame) : undefined;

  const filters: AppliedFilter[] = [
    ...(search.game
      ? [
          {
            key: "game",
            name: "Game",
            value: search.game,
            label: filteredGame?.name ?? search.game,
          },
        ]
      : []),
    ...(filteredSchool && search.school
      ? [
          {
            key: "school",
            name: "School",
            value: search.school,
            label: filteredSchool.name,
          },
        ]
      : []),
  ];
  const chips = activeFilterChips(filters);
  const loosest = mostRestrictiveChip(chips, ["school", "game"]);

  return (
    <main className="directory-page">
      <PageIntro
        variant="directory"
        title="Teams"
        lede="Find players who share your games. Build a team at your school or across campuses."
        actions={
          authenticated ? (
            <ButtonLink variant="primary" to="/teams/new">
              Create team
            </ButtonLink>
          ) : (
            <ButtonLink
              variant="primary"
              to="/login"
              search={{ next: "/teams/new" }}
            >
              Log in to create a team
            </ButtonLink>
          )
        }
      />

      <PageNoticeView
        notice={search.team ? teamBrowseNotices[search.team] : undefined}
      />

      <NoScriptFilterSearch
        action="/teams"
        fields={[
          { label: "Search schools", name: "school_q", query: search.school_q },
          { label: "Search games", name: "game_q", query: search.game_q },
        ]}
        preserve={{ game: search.game, school: search.school }}
      />
      <FilterForm
        action="/teams"
        formKey={JSON.stringify(paginationSearch(search, {}))}
      >
        <FilterToolbar
          clear={
            chips.length > 0 ? <ClearFiltersLink to="/teams" /> : undefined
          }
          label="Team filters"
          search={
            <>
              <SearchFilter
                chosen={chosenSchool}
                fallbackOptions={searchFilterFallback(
                  chosenSchool,
                  catalog.schools.map(schoolFilterOption),
                )}
                label="School"
                minimumLength={2}
                name="school"
                noun="schools"
                placeholder="Search for a school"
                search={searchSchoolFilter}
              />
              <SearchFilter
                chosen={chosenGame}
                fallbackOptions={searchFilterFallback(
                  chosenGame,
                  catalog.games.map(gameFilterOption),
                )}
                label="Game"
                minimumLength={1}
                name="game"
                noun="games"
                placeholder="Search for a game"
                search={searchGameFilter}
              />
            </>
          }
        />
      </FilterForm>

      <ResultsAnnouncement
        message={
          catalog.teamsUnavailable
            ? "Teams are unavailable right now."
            : resultsAnnouncement(catalog.teams.length, "team", chips.length)
        }
      />

      <DirectoryResults
        busy={busy}
        label="Team results"
        resultsRef={resultsRef}
      >
        {catalog.teamsUnavailable ? (
          <ListUnavailable heading="Teams are unavailable right now" />
        ) : catalog.teams.length > 0 ? (
          <div className="list">
            {catalog.teams.map((team) => (
              <Link
                className={directoryRowClassName}
                key={team.id}
                to="/teams/$slug"
                params={{ slug: team.slug }}
              >
                <DirectoryRow
                  action="View team"
                  counts={
                    <small className="directory-row__count">
                      <Users aria-hidden="true" size={14} strokeWidth={1.75} />
                      {team.member_count} member
                      {team.member_count === 1 ? "" : "s"}
                    </small>
                  }
                  identity={
                    <span aria-hidden="true" className="team-mark">
                      {team.name.slice(0, 1).toUpperCase()}
                    </span>
                  }
                  media={<EventGameThumb decorative games={team.games} />}
                  meta={[team.school?.name ?? "Independent team"]}
                  name={team.name}
                  tags={team.games.map((game) => game.name)}
                />
              </Link>
            ))}
          </div>
        ) : (
          <Surface variant="empty">
            <h2>No teams found</h2>
            {chips.length > 0 ? (
              <p>
                Nothing matches{" "}
                {filters.map((f) => `${f.name}: ${f.label}`).join(", ")}.
              </p>
            ) : (
              <p>
                No one has started a team yet. Start one and invite the people
                you play with.
              </p>
            )}
            {chips.length > 0 ? (
              <div className="actions">
                {loosest && chips.length > 1 ? (
                  <ButtonLink
                    variant="primary"
                    to="/teams"
                    search={loosest.search}
                  >
                    Remove {loosest.text}
                  </ButtonLink>
                ) : null}
                <ButtonLink variant="secondary" to="/teams">
                  Clear all filters
                </ButtonLink>
              </div>
            ) : null}
          </Surface>
        )}
      </DirectoryResults>

      {previousSearch || nextSearch ? (
        <nav
          className="pagination"
          onClick={onPaginate}
          aria-label="Team pages"
        >
          {previousSearch ? (
            <Link to="/teams" search={previousSearch}>
              <ArrowLeft aria-hidden="true" size={16} strokeWidth={2} />
              Previous
            </Link>
          ) : (
            <span />
          )}
          {nextSearch ? (
            <Link to="/teams" search={nextSearch}>
              Next
              <ArrowRight aria-hidden="true" size={16} strokeWidth={2} />
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
    ...(search.school_q ? { school_q: search.school_q } : {}),
    ...(search.game_q ? { game_q: search.game_q } : {}),
    ...cursor,
  };
}

function TeamsPending() {
  return <RoutePending message="Loading teams…" />;
}
