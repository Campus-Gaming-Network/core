import {
  DirectoryResults,
  useDirectoryResults,
} from "../components/directory-results";
import { Link, createFileRoute } from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Search,
  Shield,
  Users,
} from "lucide-react";
import { ButtonLink } from "../components/button-link";
import {
  DirectoryRow,
  directoryRowClassName,
} from "../components/directory-row";
import {
  ClearFiltersLink,
  FilterForm,
  FilterSelect,
  FilterToolbar,
  ResultsAnnouncement,
} from "../components/filter-toolbar";
import {
  activeFilterChips,
  resultsAnnouncement,
} from "../components/directory-filters";
import { PageNoticeView } from "../components/page-notice-view";
import { ListUnavailable, RoutePending } from "../components/route-boundaries";
import { SchoolMark } from "../components/school-mark";
import { getSchoolsCatalog } from "../features/school-slice/catalog.functions";
import {
  catalogClientStaleTime,
  schoolsBrowseInput,
  validateSchoolsSearch,
  type SchoolsSearch,
} from "../features/school-slice/contracts";
import {
  schoolActivityCounts,
  schoolBrowseNotices,
  schoolLocation,
  schoolShortName,
  schoolsHead,
} from "../features/school-slice/presentation";
import { usStates } from "../features/school-slice/us-states";

// Each count's icon in a school row; team rows use the same people icon.
const activityIcons = {
  teams: Shield,
  upcoming_events: CalendarDays,
  members: Users,
} as const;

export const Route = createFileRoute("/schools/")({
  validateSearch: validateSchoolsSearch,
  loaderDeps: ({ search }) => schoolsBrowseInput(search),
  loader: async ({ context, deps }) => {
    const catalog = await getSchoolsCatalog({ data: deps });
    return { catalog, publicOrigin: context.publicOrigin };
  },
  staleTime: catalogClientStaleTime,
  head: ({ loaderData }) => schoolsHead(loaderData?.publicOrigin),
  pendingComponent: SchoolsPending,
  component: SchoolsPage,
});

function SchoolsPage() {
  const { busy, onPaginate, resultsRef } = useDirectoryResults();
  const { catalog } = Route.useLoaderData();
  const search = Route.useSearch();
  const page = search.page ?? 1;
  const previousSearch =
    page > 1
      ? catalogSearch(search, page > 2 ? page - 1 : undefined)
      : undefined;
  const nextSearch = catalog.has_more
    ? catalogSearch(search, page + 1)
    : undefined;

  const chips = activeFilterChips([
    ...(search.q
      ? [{ key: "q", name: "Search", value: search.q, label: search.q }]
      : []),
    ...(search.state
      ? [
          {
            key: "state",
            name: "State",
            value: search.state,
            label:
              usStates.find((state) => state.value === search.state)?.label ??
              search.state,
          },
        ]
      : []),
  ]);

  return (
    <main className="directory-page">
      <section className="directory-heading">
        <div>
          <h1>Schools</h1>
          <p className="lede">
            Find your campus and see who is playing there. Follow a school to
            keep up with its events and teams.
          </p>
        </div>
      </section>

      <PageNoticeView
        notice={search.follow ? schoolBrowseNotices[search.follow] : undefined}
      />

      <FilterForm
        action="/schools"
        formKey={JSON.stringify(catalogSearch(search))}
      >
        <FilterToolbar
          clear={
            chips.length > 0 ? <ClearFiltersLink to="/schools" /> : undefined
          }
          label="School filters"
          search={
            <div className="filter-search">
              <label className="visually-hidden" htmlFor="schools-search">
                Search schools
              </label>
              <Search
                aria-hidden="true"
                className="filter-search__icon"
                size={18}
                strokeWidth={2}
              />
              <input
                defaultValue={search.q}
                id="schools-search"
                name="q"
                placeholder="Search by school name"
                enterKeyHint="search"
                type="search"
              />
              <button className="filter-search__submit" type="submit">
                Search
              </button>
            </div>
          }
        >
          <FilterSelect
            label="State"
            name="state"
            options={usStates}
            value={search.state}
          />
        </FilterToolbar>
      </FilterForm>

      <ResultsAnnouncement
        message={
          catalog.unavailable
            ? "Schools are unavailable right now."
            : resultsAnnouncement(
                catalog.schools.length,
                "school",
                chips.length,
              )
        }
      />

      <DirectoryResults
        busy={busy}
        label="School results"
        resultsRef={resultsRef}
      >
        {catalog.unavailable ? (
          <ListUnavailable heading="Schools are unavailable right now" />
        ) : catalog.schools.length > 0 ? (
          <section aria-labelledby="school-results-heading">
            <div className="results-heading">
              <h2 id="school-results-heading">Results</h2>
              <span>
                Showing {catalog.schools.length} · Page {page}
              </span>
            </div>
            <div className="list">
              {catalog.schools.map((school) => {
                const stats = catalog.stats[school.slug];
                return (
                  <Link
                    className={directoryRowClassName}
                    key={school.id}
                    to="/schools/$slug"
                    params={{ slug: school.slug }}
                  >
                    <DirectoryRow
                      action="View school"
                      counts={
                        stats
                          ? schoolActivityCounts(stats).map(
                              ({ kind, label }) => {
                                const Icon = activityIcons[kind];
                                return (
                                  <small
                                    className="directory-row__count"
                                    key={kind}
                                  >
                                    <Icon
                                      aria-hidden="true"
                                      size={14}
                                      strokeWidth={1.75}
                                    />
                                    {label}
                                  </small>
                                );
                              },
                            )
                          : undefined
                      }
                      identity={
                        <SchoolMark
                          logoURL={
                            school.logo_wordmark ? undefined : school.logo_url
                          }
                          name={school.name}
                          size={44}
                          slug={school.slug}
                        />
                      }
                      meta={[schoolShortName(school), schoolLocation(school)]}
                      name={school.name}
                    />
                  </Link>
                );
              })}
            </div>
          </section>
        ) : (
          <section className="empty-state">
            <h2>No schools found</h2>
            <p>
              {chips.length > 0
                ? `Nothing matches ${chips.map((chip) => chip.text).join(", ")}. Try a broader school name or check the spelling.`
                : "Schools will appear here once they are added."}
            </p>
            {chips.length > 0 ? (
              <div className="actions">
                <ButtonLink variant="secondary" to="/schools">
                  Clear all filters
                </ButtonLink>
              </div>
            ) : null}
          </section>
        )}
      </DirectoryResults>

      {previousSearch || nextSearch ? (
        <nav
          className="pagination"
          onClick={onPaginate}
          aria-label="School pages"
        >
          {previousSearch ? (
            <Link to="/schools" search={previousSearch}>
              <ArrowLeft aria-hidden="true" size={16} strokeWidth={2} />
              Previous
            </Link>
          ) : (
            <span />
          )}
          <span>Page {page}</span>
          {nextSearch ? (
            <Link to="/schools" search={nextSearch}>
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

function catalogSearch(search: SchoolsSearch, page?: number): SchoolsSearch {
  return {
    ...(search.q ? { q: search.q } : {}),
    ...(search.state ? { state: search.state } : {}),
    ...(page && page > 1 ? { page } : {}),
  };
}

function SchoolsPending() {
  return <RoutePending message="Loading schools…" />;
}
