import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { PageNoticeView } from "../components/page-notice-view";
import { ListUnavailable, RoutePending } from "../components/route-boundaries";
import { SchoolLogo } from "../components/school-logo";
import { getSchoolsCatalog } from "../features/school-slice/catalog.functions";
import {
  catalogClientStaleTime,
  schoolsBrowseInput,
  validateSchoolsSearch,
  type SchoolsSearch,
} from "../features/school-slice/contracts";
import {
  schoolBrowseNotices,
  schoolLocation,
  schoolsHead,
} from "../features/school-slice/presentation";

export const Route = createFileRoute("/schools/")({
  validateSearch: validateSchoolsSearch,
  loaderDeps: ({ search }) => schoolsBrowseInput(search),
  loader: async ({ context, deps }) => ({
    catalog: await getSchoolsCatalog({ data: deps }),
    publicOrigin: context.publicOrigin,
  }),
  staleTime: catalogClientStaleTime,
  head: ({ loaderData }) => schoolsHead(loaderData?.publicOrigin),
  pendingComponent: SchoolsPending,
  component: SchoolsPage,
});

function SchoolsPage() {
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

  return (
    <main className="browse-page school-directory-page">
      <section className="page-heading browse-heading">
        <p className="eyebrow">Schools</p>
        <h1>Browse schools</h1>
        <p className="lede">
          Find your campus, see what is happening there, and follow it for
          updates.
        </p>
      </section>

      <PageNoticeView
        notice={search.follow ? schoolBrowseNotices[search.follow] : undefined}
      />

      <form
        action="/schools"
        className="search-bar filter-bar school-filter-bar"
        method="get"
      >
        <label>
          Search
          <input
            name="q"
            defaultValue={search.q}
            placeholder="University, college, campus"
          />
        </label>
        <button type="submit">Find schools</button>
      </form>

      {catalog.unavailable ? (
        <ListUnavailable heading="Schools are unavailable right now" />
      ) : catalog.schools.length > 0 ? (
        <section aria-labelledby="school-results-heading">
          <div className="results-heading">
            <div>
              <h2 id="school-results-heading">Schools</h2>
            </div>
            <span>
              Showing {catalog.schools.length} · Page {page}
            </span>
          </div>
          <div className="school-directory-grid">
            {catalog.schools.map((school) => (
              <Link
                className="card card--default school-directory-card"
                key={school.id}
                to="/schools/$slug"
                params={{ slug: school.slug }}
              >
                <span aria-hidden="true" className="school-directory-mark">
                  {school.name.slice(0, 1).toUpperCase()}
                  <SchoolLogo logoURL={school.logo_url} size={44} />
                </span>
                <span className="school-directory-copy">
                  <strong>{school.name}</strong>
                  {school.alias ? <small>{school.alias}</small> : null}
                  <small>{schoolLocation(school)}</small>
                </span>
                <span className="school-directory-action with-arrow">
                  View school
                  <ArrowRight aria-hidden="true" size={14} strokeWidth={2.25} />
                </span>
              </Link>
            ))}
          </div>
        </section>
      ) : (
        <section className="empty-state">
          <h2>No schools found</h2>
          <p>Try a broader school name or check the spelling.</p>
        </section>
      )}

      {previousSearch || nextSearch ? (
        <nav className="pagination" aria-label="School pages">
          {previousSearch ? (
            <Link to="/schools" search={previousSearch}>
              Previous
            </Link>
          ) : (
            <span />
          )}
          <span>Page {page}</span>
          {nextSearch ? (
            <Link to="/schools" search={nextSearch}>
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
