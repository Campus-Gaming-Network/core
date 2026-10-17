import {
  DirectoryResults,
  useDirectoryResults,
} from "../components/directory-results";
import {
  Link,
  createFileRoute,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, Search } from "lucide-react";
import { ButtonLink } from "../components/button-link";
import {
  ListUnavailable,
  RouteErrorView,
  RoutePending,
} from "../components/route-boundaries";
import { PageNoticeView } from "../components/page-notice-view";
import {
  activeFilterChips,
  mostRestrictiveChip,
  resultsAnnouncement,
  type AppliedFilter,
} from "../components/directory-filters";
import {
  ClearFiltersLink,
  FilterDate,
  FilterForm,
  FilterSelect,
  FilterToggle,
  FilterToolbar,
  LockedFilter,
  NoScriptFilterSearch,
  ResultsAnnouncement,
} from "../components/filter-toolbar";
import {
  SearchFilter,
  searchFilterFallback,
} from "../components/search-filter";
import type { GameFilterChoices } from "../features/game-picker/contracts";
import {
  gameFilterOption,
  searchGameFilter,
} from "../features/game-picker/game-filter-options";
import {
  getGameFilterChoices,
  getSchoolFilterChoices,
} from "../features/school-slice/catalog.functions";
import {
  schoolFilterOption,
  searchSchoolFilter,
} from "../features/school-slice/school-filter-options";
import type { SchoolFilterChoices } from "../features/school-slice/contracts";
import { getEventsViewer } from "../features/event-slice/auth.functions";
import { EventCard } from "../features/event-slice/event-card";
import { EventScopeTabs } from "../features/event-slice/event-scope-tabs";
import {
  currentEventScope,
  eventScopeSearch,
  type EventScope,
} from "../features/event-slice/event-scope";
import { getEventsBrowse } from "../features/event-slice/event.functions";
import {
  eventsBrowseInput,
  validateEventsSearch,
  type EventsSearch,
} from "../features/event-slice/contracts";
import {
  eventAudienceLabels,
  eventBrowseNotices,
  eventFormatLabel,
  eventsHead,
  eventTypeLabels,
} from "../features/event-slice/presentation";

export const Route = createFileRoute("/events/")({
  validateSearch: validateEventsSearch,
  loaderDeps: ({ search }) => ({
    browse: eventsBrowseInput(search),
    schoolQuery: search.school_q,
    gameQuery: search.game_q,
  }),
  loader: async ({ context, deps }) => {
    const { game, school } = deps.browse;
    const [browse, session, schoolFilter, gameFilter] = await Promise.all([
      getEventsBrowse({ data: deps.browse }),
      getEventsViewer(),
      school || deps.schoolQuery
        ? getSchoolFilterChoices({
            data: { school, schoolQuery: deps.schoolQuery },
          })
        : noSchoolFilterChoices,
      game || deps.gameQuery
        ? getGameFilterChoices({
            data: { game, gameQuery: deps.gameQuery },
          })
        : noGameFilterChoices,
    ]);
    if (session.status === "unavailable") {
      throw new Error("Event viewer session is unavailable");
    }

    return {
      browse,
      schoolFilter,
      gameFilter,
      authenticated: session.status === "authenticated",
      homeSchool:
        session.status === "authenticated" ? session.homeSchool : undefined,
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
  head: ({ loaderData }) => eventsHead(loaderData?.publicOrigin),
  pendingComponent: EventsPending,
  errorComponent: EventsError,
  component: EventsPage,
});

function EventsPage() {
  const { busy, onPaginate, resultsRef } = useDirectoryResults();
  const { authenticated, browse, gameFilter, homeSchool, schoolFilter } =
    Route.useLoaderData();
  const search = Route.useSearch();
  const previousSearch =
    browse.has_previous && browse.previous_cursor
      ? paginationSearch(search, { before: browse.previous_cursor })
      : undefined;
  const nextSearch =
    browse.has_more && browse.next_cursor
      ? paginationSearch(search, { after: browse.next_cursor })
      : undefined;

  // The current scope tab owns its filter: the Online tab fixes the format,
  // Tournaments the type, and My school the school. That filter is shown by
  // the tab, locked in the toolbar, and not counted as a filter to clear.
  const scope = currentEventScope(search, homeSchool?.slug);
  const scopeFilter = scopeFilterKeys[scope];
  const filters = appliedEventFilters(
    search,
    browse,
    schoolFilter.selectedSchool ?? homeSchool,
    gameFilter.selectedGame,
  ).filter((filter) => filter.key !== scopeFilter);
  const chosenSchool = schoolFilter.selectedSchool
    ? schoolFilterOption(schoolFilter.selectedSchool)
    : undefined;
  const chosenGame = gameFilter.selectedGame
    ? gameFilterOption(gameFilter.selectedGame)
    : undefined;
  // Removing one filter keeps the tab and the filter it sets.
  const tabSearch = eventScopeSearch({}, scope, homeSchool?.slug) as Record<
    string,
    string
  >;
  const chips = activeFilterChips(filters).map((chip) => ({
    ...chip,
    search: { ...tabSearch, ...chip.search },
  }));
  const loosest = mostRestrictiveChip(chips, restrictiveOrder);

  return (
    <main className="directory-page">
      <section className="directory-heading">
        <div>
          <h1>Events</h1>
          <p className="lede">
            Discover gaming events at your school and beyond. Unlisted events
            open by direct link, and private events stay locked until unlocked.
          </p>
        </div>
        {authenticated ? (
          <ButtonLink variant="primary" to="/events/new">
            Create event
          </ButtonLink>
        ) : (
          <ButtonLink
            variant="primary"
            to="/login"
            search={{ next: "/events/new" }}
          >
            Log in to create an event
          </ButtonLink>
        )}
      </section>

      <PageNoticeView
        notice={search.event ? eventBrowseNotices[search.event] : undefined}
      />

      <EventScopeTabs homeSchool={homeSchool} search={search} />

      <NoScriptFilterSearch
        action="/events"
        fields={[
          { label: "Search schools", name: "school_q", query: search.school_q },
          { label: "Search games", name: "game_q", query: search.game_q },
        ]}
        preserve={{
          game: search.game,
          school: search.school,
          format: search.format,
          type: search.type,
          audience: search.audience,
          cost: search.cost,
          q: search.q,
          from: search.from,
          to: search.to,
          scope: scope === "all" ? undefined : scope,
        }}
      />
      {/* The controls start from the URL. A scope tab or Back navigates
          without a page load, so the key remounts the form for the new query. */}
      <FilterForm
        action="/events"
        formKey={JSON.stringify(paginationSearch(search, {}))}
      >
        {/* Filtering inside a tab stays on that tab. */}
        {scope === "all" ? null : (
          <input name="scope" type="hidden" value={scope} />
        )}
        <FilterToolbar
          clear={
            filters.length > 0 ? (
              <ClearFiltersLink
                search={eventScopeSearch({}, scope, homeSchool?.slug)}
                to="/events"
              />
            ) : undefined
          }
          label="Event filters"
          search={
            <>
              <div className="filter-search">
                <label className="visually-hidden" htmlFor="events-keyword">
                  Search event titles
                </label>
                <Search
                  aria-hidden="true"
                  className="filter-search__icon"
                  size={18}
                  strokeWidth={2}
                />
                <input
                  defaultValue={search.q}
                  id="events-keyword"
                  maxLength={100}
                  name="q"
                  placeholder="Search event titles"
                  type="search"
                />
                <button className="filter-search__submit" type="submit">
                  Search
                </button>
              </div>
              {scopeFilter === "school" && search.school ? (
                <LockedFilter
                  label="School"
                  name="school"
                  reason="the My school tab"
                  value={search.school}
                  valueLabel={homeSchool?.name ?? "Your school"}
                />
              ) : (
                <SearchFilter
                  chosen={chosenSchool}
                  fallbackOptions={searchFilterFallback(
                    chosenSchool,
                    schoolFilter.schools.map(schoolFilterOption),
                  )}
                  label="School"
                  minimumLength={2}
                  name="school"
                  noun="schools"
                  placeholder="Search for a school"
                  search={searchSchoolFilter}
                />
              )}
              <SearchFilter
                chosen={chosenGame}
                fallbackOptions={searchFilterFallback(
                  chosenGame,
                  gameFilter.games.map(gameFilterOption),
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
          {scopeFilter === "format" && search.format ? (
            <LockedFilter
              label="Format"
              name="format"
              reason="the Online tab"
              value={search.format}
              valueLabel={eventFormatLabel(search.format)}
            />
          ) : (
            <FilterSelect
              label="Format"
              name="format"
              options={eventFormats.map((format) => ({
                value: format,
                label: eventFormatLabel(format),
              }))}
              value={search.format}
            />
          )}
          {scopeFilter === "type" && search.type ? (
            <LockedFilter
              label="Type"
              name="type"
              reason="the Tournaments tab"
              value={search.type}
              valueLabel={eventTypeLabels[search.type]}
            />
          ) : (
            <FilterSelect
              label="Type"
              name="type"
              options={Object.entries(eventTypeLabels).map(
                ([value, label]) => ({ value, label }),
              )}
              value={search.type}
            />
          )}
          <FilterSelect
            label="Audience"
            name="audience"
            options={Object.entries(eventAudienceLabels).map(
              ([value, label]) => ({ value, label }),
            )}
            value={search.audience}
          />
          <FilterToggle
            checked={search.cost === "free"}
            label="Free only"
            name="cost"
            value="free"
          />
          {/* Dates read in each event's own time zone, as its page shows. */}
          <FilterDate
            label="From"
            max={search.to}
            name="from"
            value={search.from}
          />
          <FilterDate
            label="To"
            min={search.from}
            name="to"
            value={search.to}
          />
        </FilterToolbar>
      </FilterForm>

      <ResultsAnnouncement
        message={
          browse.eventsUnavailable
            ? "Events are unavailable right now."
            : resultsAnnouncement(browse.events.length, "event", chips.length)
        }
      />

      <DirectoryResults
        busy={busy}
        label="Event results"
        resultsRef={resultsRef}
      >
        {browse.eventsUnavailable ? (
          <ListUnavailable heading="Events are unavailable right now" />
        ) : browse.events.length > 0 ? (
          <div className="list">
            {browse.events.map((event) => (
              <EventCard event={event} key={event.id} />
            ))}
          </div>
        ) : (
          <section className="empty-state">
            <h2>No public events found</h2>
            {chips.length > 0 ? (
              <p>
                Nothing matches{" "}
                {filters
                  .map((filter) => `${filter.name}: ${filter.label}`)
                  .join(", ")}
                .
              </p>
            ) : (
              <p>Create the first event for your campus.</p>
            )}
            {chips.length > 0 ? (
              <div className="actions">
                {loosest && chips.length > 1 ? (
                  <ButtonLink
                    variant="primary"
                    to="/events"
                    search={loosest.search}
                  >
                    Remove {loosest.text}
                  </ButtonLink>
                ) : null}
                <ButtonLink variant="secondary" to="/events">
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
          aria-label="Event pages"
        >
          {previousSearch ? (
            <Link to="/events" search={previousSearch}>
              <ArrowLeft aria-hidden="true" size={16} strokeWidth={2} />
              Previous
            </Link>
          ) : (
            <span />
          )}
          {nextSearch ? (
            <Link to="/events" search={nextSearch}>
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

function paginationSearch(
  search: EventsSearch,
  cursor: Pick<EventsSearch, "after" | "before">,
): EventsSearch {
  return {
    ...(search.game ? { game: search.game } : {}),
    ...(search.school ? { school: search.school } : {}),
    ...(search.format ? { format: search.format } : {}),
    ...(search.audience ? { audience: search.audience } : {}),
    ...(search.type ? { type: search.type } : {}),
    ...(search.cost ? { cost: search.cost } : {}),
    ...(search.q ? { q: search.q } : {}),
    ...(search.from ? { from: search.from } : {}),
    ...(search.to ? { to: search.to } : {}),
    ...(search.scope ? { scope: search.scope } : {}),
    ...(search.school_q ? { school_q: search.school_q } : {}),
    ...(search.game_q ? { game_q: search.game_q } : {}),
    ...cursor,
  };
}

const eventFormats = ["online", "in_person", "hybrid"] as const;

const noSchoolFilterChoices: SchoolFilterChoices = {
  schools: [],
  schoolSearchFailed: false,
};

const noGameFilterChoices: GameFilterChoices = {
  games: [],
  gameSearchFailed: false,
};

/** Filters from the narrowest to the broadest, for the empty-results shortcut. */
const restrictiveOrder = [
  "q",
  "school",
  "type",
  "game",
  "from",
  "to",
  "audience",
  "format",
  "cost",
];

/** The filter each scope tab sets, which the form locks while it is open. */
const scopeFilterKeys: Record<EventScope, string | undefined> = {
  all: undefined,
  "my-school": "school",
  online: "format",
  tournaments: "type",
};

/**
 * The applied filters with readable values. The school and game are named by
 * the filter's own lookup, the viewer's home school, or a listed event, and
 * otherwise stay generic.
 */
function appliedEventFilters(
  search: EventsSearch,
  browse: {
    events: { host_school: { slug: string; name: string } }[];
  },
  namedSchool: { slug: string; name: string } | undefined,
  namedGame: { slug: string; name: string } | undefined,
): AppliedFilter[] {
  const filters: AppliedFilter[] = [];
  if (search.game)
    filters.push({
      key: "game",
      name: "Game",
      value: search.game,
      label: namedGame?.slug === search.game ? namedGame.name : search.game,
    });
  if (search.school)
    filters.push({
      key: "school",
      name: "School",
      value: search.school,
      label:
        (namedSchool?.slug === search.school ? namedSchool.name : undefined) ??
        browse.events.find((event) => event.host_school.slug === search.school)
          ?.host_school.name ??
        "Selected school",
    });
  if (search.format)
    filters.push({
      key: "format",
      name: "Format",
      value: search.format,
      label: eventFormatLabel(search.format),
    });
  if (search.type)
    filters.push({
      key: "type",
      name: "Type",
      value: search.type,
      label: eventTypeLabels[search.type],
    });
  if (search.audience)
    filters.push({
      key: "audience",
      name: "Audience",
      value: search.audience,
      label: eventAudienceLabels[search.audience],
    });
  if (search.cost)
    filters.push({
      key: "cost",
      name: "Cost",
      value: search.cost,
      label: "Free",
    });
  if (search.q)
    filters.push({
      key: "q",
      name: "Keyword",
      value: search.q,
      label: `“${search.q}”`,
    });
  if (search.from)
    filters.push({
      key: "from",
      name: "From",
      value: search.from,
      label: formatFilterDate(search.from),
    });
  if (search.to)
    filters.push({
      key: "to",
      name: "To",
      value: search.to,
      label: formatFilterDate(search.to),
    });
  return filters;
}

/** "May 1, 2031" for a filter's YYYY-MM-DD date, the same in every zone. */
function formatFilterDate(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

function EventsPending() {
  return <RoutePending message="Loading events…" />;
}

function EventsError({ reset }: ErrorComponentProps) {
  return (
    <RouteErrorView
      reset={reset}
      eyebrow="Events unavailable"
      heading="We could not load events."
      description="Please try again in a moment."
      showNavigation={false}
    />
  );
}
