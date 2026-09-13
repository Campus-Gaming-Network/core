import { Link, createFileRoute } from "@tanstack/react-router";
import { RoutePending } from "../components/route-boundaries";
import { getSchoolsCatalog } from "../features/school-slice/catalog.functions";
import {
  catalogClientStaleTime,
  schoolsBrowseInput,
  validateSchoolsSearch,
  type SchoolsSearch
} from "../features/school-slice/contracts";
import {
  schoolLocation,
  schoolsHead
} from "../features/school-slice/presentation";

export const Route = createFileRoute("/schools/")({
  validateSearch: validateSchoolsSearch,
  loaderDeps: ({ search }) => schoolsBrowseInput(search),
  loader: async ({ context, deps }) => ({
    catalog: await getSchoolsCatalog({ data: deps }),
    publicOrigin: context.publicOrigin
  }),
  staleTime: catalogClientStaleTime,
  head: ({ loaderData }) => schoolsHead(loaderData?.publicOrigin),
  pendingComponent: SchoolsPending,
  component: SchoolsPage
});

function SchoolsPage() {
  const { catalog } = Route.useLoaderData();
  const search = Route.useSearch();
  const page = search.page ?? 1;
  const previousSearch = page > 1
    ? catalogSearch(search, page > 2 ? page - 1 : undefined)
    : undefined;
  const nextSearch = catalog.has_more
    ? catalogSearch(search, page + 1)
    : undefined;

  return (
    <main className="narrow">
      <section className="page-heading">
        <p className="eyebrow">Schools</p>
        <h1>Browse schools</h1>
        <p className="lede">
          Search by school name or filter by state. Main and branch campuses are
          listed the same way.
        </p>
      </section>

      {search.follow ? <FollowNotice status={search.follow} /> : null}

      <form action="/schools" className="search-bar" method="get">
        <label>
          Search
          <input
            name="q"
            defaultValue={search.q}
            placeholder="University, college, campus"
          />
        </label>
        <label>
          State
          <input
            name="state"
            defaultValue={search.state}
            placeholder="CA"
            maxLength={2}
          />
        </label>
        <button type="submit">Search</button>
      </form>

      {catalog.schools.length > 0 ? (
        <div className="list">
          {catalog.schools.map((school) => (
            <Link
              className="card card--default list-item"
              key={school.id}
              to="/schools/$slug"
              params={{ slug: school.slug }}
            >
              <span>
                <strong>{school.name}</strong>
                {school.alias ? <small>{school.alias}</small> : null}
              </span>
              <span>{schoolLocation(school)}</span>
            </Link>
          ))}
        </div>
      ) : (
        <section className="empty-state">
          <h2>No schools found</h2>
          <p>
            Try a broader school name or clear the state filter. If this keeps
            happening, the API may still be starting.
          </p>
        </section>
      )}

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
    </main>
  );
}

function catalogSearch(search: SchoolsSearch, page?: number): SchoolsSearch {
  return {
    ...(search.q ? { q: search.q } : {}),
    ...(search.state ? { state: search.state } : {}),
    ...(page && page > 1 ? { page } : {})
  };
}

function FollowNotice({ status }: { status: NonNullable<SchoolsSearch["follow"]> }) {
  const messages = {
    added: "School followed.",
    failed: "We could not update this school follow. Please try again.",
    removed: "School unfollowed."
  } as const;

  return (
    <p role={status === "failed" ? "alert" : "status"} aria-live="polite">
      {messages[status]}
    </p>
  );
}

function SchoolsPending() {
  return <RoutePending message="Loading schools…" />;
}
