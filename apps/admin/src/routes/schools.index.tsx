import { Link, createFileRoute } from "@tanstack/react-router";
import { DataTable, dataColumn } from "../components/data-table";
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
  type AdminSchool,
} from "../features/catalog/contracts";

export const Route = createFileRoute("/schools/")({
  validateSearch: validateCatalogSearch("schools"),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => getSchools({ data: deps }),
  staleTime: 0,
  head: () => ({ meta: [{ title: "Schools | CGN Admin Console" }] }),
  component: SchoolsPage,
});

const schoolColumns = [
  dataColumn<AdminSchool>({
    id: "name",
    header: "School",
    sortValue: (row) => row.name,
    cell: (row) => (
      <Link
        className="data-table__primary"
        params={{ schoolId: row.id }}
        to="/schools/$schoolId"
      >
        {row.name}
      </Link>
    ),
  }),
  dataColumn<AdminSchool>({
    id: "slug",
    header: "Slug",
    sortValue: (row) => row.slug,
    cell: (row) => <code>{row.slug}</code>,
  }),
  dataColumn<AdminSchool>({
    id: "location",
    header: "Location",
    sortValue: (row) => [row.city, row.state].filter(Boolean).join(", ") || "—",
  }),
  dataColumn<AdminSchool>({
    id: "state",
    header: "State",
    sortValue: (row) => recordState(row),
    cell: (row) => <StateBadge state={recordState(row)} />,
  }),
];

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
          <Link className="primary-button" to="/schools/new">
            <span aria-hidden="true">+</span> New school
          </Link>
        ) : null}
      </header>

      <CatalogFilters
        action="/schools"
        label="Name, alias, or slug"
        search={search}
        states={catalogListKinds.schools}
      >
        <label>
          Location (state code)
          <input
            defaultValue={search.region ?? ""}
            maxLength={2}
            name="region"
            pattern="[A-Za-z]{2}"
            placeholder="CA"
            spellCheck={false}
          />
        </label>
      </CatalogFilters>

      {page.schools.length ? (
        <DataTable
          columns={schoolColumns}
          data={page.schools}
          getRowId={(school) => school.id}
          label="Schools"
        />
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
