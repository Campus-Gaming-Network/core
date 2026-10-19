import { Link, createFileRoute } from "@tanstack/react-router";
import { DataTable, dataColumn } from "../components/data-table";
import {
  CatalogFilters,
  CursorPagination,
  StateBadge,
} from "../features/catalog/catalog-components";
import { getClubs } from "../features/catalog/catalog.functions";
import {
  catalogListKinds,
  clubTypeLabels,
  validateCatalogSearch,
  type AdminClub,
} from "../features/catalog/contracts";

export const Route = createFileRoute("/clubs/")({
  validateSearch: validateCatalogSearch("clubs"),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => getClubs({ data: deps }),
  staleTime: 0,
  head: () => ({ meta: [{ title: "Clubs | CGN Admin Console" }] }),
  component: ClubsPage,
});

// A club is published or hidden; the shared badge reads those as active and
// inactive, so this names them for clubs.
function clubState(club: AdminClub): "published" | "hidden" {
  return club.is_active ? "published" : "hidden";
}

const clubColumns = [
  dataColumn<AdminClub>({
    id: "name",
    header: "Club",
    sortValue: (row) => row.name,
    cell: (row) => (
      <Link
        className="data-table__primary"
        params={{ clubId: row.id }}
        to="/clubs/$clubId"
      >
        {row.name}
      </Link>
    ),
  }),
  dataColumn<AdminClub>({
    id: "school",
    header: "School",
    sortValue: (row) => row.school.name,
    cell: (row) => (
      <Link params={{ schoolId: row.school.id }} to="/schools/$schoolId">
        {row.school.name}
      </Link>
    ),
  }),
  dataColumn<AdminClub>({
    id: "type",
    header: "Type",
    sortValue: (row) => clubTypeLabels[row.type],
  }),
  dataColumn<AdminClub>({
    id: "state",
    header: "State",
    sortValue: (row) => clubState(row),
    cell: (row) => <StateBadge state={clubState(row)} />,
  }),
];

function ClubsPage() {
  const page = Route.useLoaderData();
  const search = Route.useSearch();
  // The filter carries a school ID; its clubs name the school.
  const schoolName = search.school ? page.clubs[0]?.school.name : undefined;

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Catalog</p>
          <h1>Clubs</h1>
          <p>
            Search every club, including hidden ones. New clubs start from a
            school's page, so each belongs to the right school.
          </p>
        </div>
      </header>

      {search.school ? (
        <p className="notice">
          Showing clubs at {schoolName ?? "the selected school"}.{" "}
          <Link to="/clubs">Show every school</Link>
        </p>
      ) : null}

      <CatalogFilters
        action="/clubs"
        label="Name or slug"
        search={search}
        states={catalogListKinds.clubs}
      >
        {search.school ? (
          <input name="school" type="hidden" value={search.school} />
        ) : null}
      </CatalogFilters>

      {page.clubs.length ? (
        <DataTable
          columns={clubColumns}
          data={page.clubs}
          getRowId={(club) => club.id}
          label="Clubs"
        />
      ) : (
        <section className="empty-panel">
          <h2>No clubs match this search</h2>
          <p>
            Try another name, or add a club from its school's page in Schools.
          </p>
        </section>
      )}

      <CursorPagination
        label="Club pages"
        path="/clubs"
        search={search}
        previousCursor={page.previous_cursor}
        nextCursor={page.next_cursor}
      />
    </div>
  );
}
