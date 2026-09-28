import { Link, createFileRoute } from "@tanstack/react-router";
import {
  CatalogFilters,
  CursorPagination,
  StateBadge,
  recordState,
} from "../features/catalog/catalog-components";
import { getSchools } from "../features/catalog/catalog.functions";
import {
  catalogListKinds,
  validateCatalogSearch,
} from "../features/catalog/contracts";

export const Route = createFileRoute("/schools/")({
  validateSearch: validateCatalogSearch("schools"),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => getSchools({ data: deps }),
  staleTime: 0,
  head: () => ({ meta: [{ title: "Schools | CGN Admin Console" }] }),
  component: SchoolsPage,
});

function SchoolsPage() {
  const page = Route.useLoaderData();
  const search = Route.useSearch();
  const { admin } = Route.useRouteContext();
  const canManage =
    admin.status === "authenticated" &&
    admin.session.capabilities.includes("schools.manage");

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Catalog</p>
          <h1>Schools</h1>
          <p>
            Search every school, including inactive and deleted records. The
            public site lists only active schools.
          </p>
        </div>
        {canManage ? (
          <Link className="secondary-button" to="/schools/new">
            New school
          </Link>
        ) : null}
      </header>

      <CatalogFilters
        action="/schools"
        label="Name, alias, or slug"
        search={search}
        states={catalogListKinds.schools}
      />

      {page.schools.length ? (
        <section className="queue-list" aria-label="Schools">
          {page.schools.map((school) => (
            <Link
              className="queue-card"
              key={school.id}
              params={{ schoolId: school.id }}
              to="/schools/$schoolId"
            >
              <span className="queue-card__topline">
                <strong>{school.name}</strong>
                <StateBadge state={recordState(school)} />
              </span>
              <span>
                <code>{school.slug}</code>
                {school.city || school.state
                  ? ` · ${[school.city, school.state].filter(Boolean).join(", ")}`
                  : ""}
              </span>
            </Link>
          ))}
        </section>
      ) : (
        <section className="empty-panel">
          <h2>No schools match this search</h2>
          <p>Try another name, or clear the state filter.</p>
        </section>
      )}

      <CursorPagination
        label="School pages"
        path="/schools"
        search={search}
        previousCursor={page.previous_cursor}
        nextCursor={page.next_cursor}
      />
    </div>
  );
}
