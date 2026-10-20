import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, Search } from "lucide-react";
import { ButtonLink } from "../components/button-link";
import { Callout } from "../components/callout";
import {
  activeFilterChips,
  mostRestrictiveChip,
  resultsAnnouncement,
  type AppliedFilter,
} from "../components/directory-filters";
import {
  DirectoryResults,
  useDirectoryResults,
} from "../components/directory-results";
import {
  DirectoryRow,
  directoryRowClassName,
} from "../components/directory-row";
import {
  ClearFiltersLink,
  FilterForm,
  FilterSelect,
  FilterToolbar,
  NoScriptFilterSearch,
  ResultsAnnouncement,
} from "../components/filter-toolbar";
import { ListUnavailable, RoutePending } from "../components/route-boundaries";
import { SchoolMark } from "../components/school-mark";
import {
  SearchFilter,
  searchFilterFallback,
} from "../components/search-filter";
import { getClubsBrowsePage } from "../features/club-slice/club.functions";
import {
  clubTypeSchema,
  clubsBrowsePageInput,
  validateClubsSearch,
  type ClubsSearch,
} from "../features/club-slice/contracts";
import { clubsHead, clubTypeLabels } from "../features/club-slice/presentation";
import clubCSS from "../features/club-slice/clubs.css?url";
import { EventGameThumb } from "../features/event-slice/event-game-thumb";
import {
  gameFilterOption,
  searchGameFilter,
} from "../features/game-picker/game-filter-options";
import {
  schoolFilterOption,
  searchSchoolFilter,
} from "../features/school-slice/school-filter-options";
import { schoolLocation } from "../features/school-slice/presentation";

export const Route = createFileRoute("/clubs/")({
  validateSearch: validateClubsSearch,
  loaderDeps: ({ search }) => clubsBrowsePageInput(search),
  loader: async ({ context, deps }) => ({
    catalog: await getClubsBrowsePage({ data: deps }),
    publicOrigin: context.publicOrigin,
  }),
  staleTime: 0,
  head: ({ loaderData }) => {
    const head = clubsHead(loaderData?.publicOrigin);
    return {
      ...head,
      links: [...head.links, { rel: "stylesheet", href: clubCSS }],
    };
  },
  pendingComponent: ClubsPending,
  component: ClubsPage,
});

function ClubsPage() {
  const { busy, onPaginate, resultsRef } = useDirectoryResults();
  const { catalog } = Route.useLoaderData();
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
    ...(search.q
      ? [{ key: "q", name: "Name", value: search.q, label: `“${search.q}”` }]
      : []),
    ...(search.school && filteredSchool
      ? [
          {
            key: "school",
            name: "School",
            value: search.school,
            label: filteredSchool.name,
          },
        ]
      : []),
    ...(search.type
      ? [
          {
            key: "type",
            name: "Type",
            value: search.type,
            label: clubTypeLabels[search.type],
          },
        ]
      : []),
    ...(search.game && filteredGame
      ? [
          {
            key: "game",
            name: "Game",
            value: search.game,
            label: filteredGame.name,
          },
        ]
      : []),
  ];
  const chips = activeFilterChips(filters);
  const loosest = mostRestrictiveChip(chips, ["q", "school", "type", "game"]);

  return (
    <main className="directory-page">
      <section className="directory-heading">
        <div>
          <h1>Clubs</h1>
          <p className="lede">
            Gaming clubs and esports programs at schools across the US. Find one
            at your school and see how to join.
          </p>
        </div>
      </section>

      <Callout
        action={
          <ButtonLink
            variant="secondary"
            to="/support"
            search={{ topic: "club" }}
          >
            Add or claim a club
          </ButtonLink>
        }
      >
        Run a gaming club or esports program? If it is missing, contact support
        and we will add it. If you run a club listed here, let us know too;
        officers will be able to manage their club&apos;s page soon.
      </Callout>

      <NoScriptFilterSearch
        action="/clubs"
        fields={[
          { label: "Search schools", name: "school_q", query: search.school_q },
          { label: "Search games", name: "game_q", query: search.game_q },
        ]}
        preserve={{
          q: search.q,
          school: search.school,
          type: search.type,
          game: search.game,
        }}
      />
      <FilterForm
        action="/clubs"
        formKey={JSON.stringify(paginationSearch(search, {}))}
      >
        <FilterToolbar
          clear={
            chips.length > 0 ? <ClearFiltersLink to="/clubs" /> : undefined
          }
          label="Club filters"
          search={
            <>
              <div className="filter-search">
                <label className="visually-hidden" htmlFor="clubs-keyword">
                  Search club names
                </label>
                <Search
                  aria-hidden="true"
                  className="filter-search__icon"
                  size={18}
                  strokeWidth={2}
                />
                <input
                  defaultValue={search.q}
                  enterKeyHint="search"
                  id="clubs-keyword"
                  maxLength={100}
                  name="q"
                  placeholder="Search club names"
                  type="search"
                />
                <button className="filter-search__submit" type="submit">
                  Search
                </button>
              </div>
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
        >
          <FilterSelect
            label="Type"
            name="type"
            options={clubTypeSchema.options.map((type) => ({
              value: type,
              label: clubTypeLabels[type],
            }))}
            value={search.type}
          />
        </FilterToolbar>
      </FilterForm>

      <ResultsAnnouncement
        message={
          catalog.clubsUnavailable
            ? "Clubs are unavailable right now."
            : resultsAnnouncement(catalog.clubs.length, "club", chips.length)
        }
      />

      <DirectoryResults
        busy={busy}
        label="Club results"
        resultsRef={resultsRef}
      >
        {catalog.clubsUnavailable ? (
          <ListUnavailable heading="Clubs are unavailable right now" />
        ) : catalog.clubs.length > 0 ? (
          <div className="list">
            {catalog.clubs.map((club) => (
              <Link
                className={directoryRowClassName}
                key={club.id}
                to="/clubs/$slug"
                params={{ slug: club.slug }}
              >
                <DirectoryRow
                  action="View club"
                  identity={
                    <SchoolMark
                      logoURL={club.school.logo_url}
                      name={club.school.name}
                      size={44}
                      slug={club.school.slug}
                    />
                  }
                  media={<EventGameThumb decorative games={club.games} />}
                  meta={[club.school.name, schoolLocation(club.school, "")]}
                  name={club.name}
                  tags={[
                    clubTypeLabels[club.type],
                    ...club.games.map((game) => game.name),
                  ]}
                />
              </Link>
            ))}
          </div>
        ) : (
          <section className="empty-state">
            <h2>No clubs found</h2>
            {chips.length > 0 ? (
              <p>
                Nothing matches{" "}
                {filters.map((f) => `${f.name}: ${f.label}`).join(", ")}.
              </p>
            ) : (
              <p>
                We are adding clubs school by school. If you run one, tell us
                about it and we will add it.
              </p>
            )}
            <div className="actions">
              {chips.length > 0 ? (
                <>
                  {loosest && chips.length > 1 ? (
                    <ButtonLink
                      variant="primary"
                      to="/clubs"
                      search={loosest.search}
                    >
                      Remove {loosest.text}
                    </ButtonLink>
                  ) : null}
                  <ButtonLink variant="secondary" to="/clubs">
                    Clear all filters
                  </ButtonLink>
                </>
              ) : (
                <ButtonLink
                  variant="primary"
                  to="/support"
                  search={{ topic: "club" }}
                >
                  Add or claim a club
                </ButtonLink>
              )}
            </div>
          </section>
        )}
      </DirectoryResults>

      {previousSearch || nextSearch ? (
        <nav
          className="pagination"
          onClick={onPaginate}
          aria-label="Club pages"
        >
          {previousSearch ? (
            <Link to="/clubs" search={previousSearch}>
              <ArrowLeft aria-hidden="true" size={16} strokeWidth={2} />
              Previous
            </Link>
          ) : (
            <span />
          )}
          {nextSearch ? (
            <Link to="/clubs" search={nextSearch}>
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
  search: ClubsSearch,
  cursor: Pick<ClubsSearch, "after" | "before">,
): ClubsSearch {
  return {
    ...(search.q ? { q: search.q } : {}),
    ...(search.school ? { school: search.school } : {}),
    ...(search.type ? { type: search.type } : {}),
    ...(search.game ? { game: search.game } : {}),
    ...(search.school_q ? { school_q: search.school_q } : {}),
    ...(search.game_q ? { game_q: search.game_q } : {}),
    ...cursor,
  };
}

function ClubsPending() {
  return <RoutePending message="Loading clubs…" />;
}
