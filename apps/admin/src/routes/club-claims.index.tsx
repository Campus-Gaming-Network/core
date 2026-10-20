import { adminTitle } from "../components/page-title";
import { Timestamp } from "../components/timestamp";
import { Link, createFileRoute } from "@tanstack/react-router";
import { DataTable, dataColumn } from "../components/data-table";
import { UserLink } from "../components/user-link";
import {
  CatalogFilters,
  CursorPagination,
  StateBadge,
} from "../features/catalog/catalog-components";
import { getClubClaims } from "../features/catalog/catalog.functions";
import {
  catalogListKinds,
  validateCatalogSearch,
  type ClubClaimSummary,
} from "../features/catalog/contracts";

export const Route = createFileRoute("/club-claims/")({
  validateSearch: validateCatalogSearch("club_claims"),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => getClubClaims({ data: deps }),
  staleTime: 0,
  head: () => ({ meta: [{ title: adminTitle("Club claims") }] }),
  component: ClubClaimsPage,
});

const claimColumns = [
  dataColumn<ClubClaimSummary>({
    id: "club",
    header: "Club",
    sortValue: (row) => row.club_name,
    cell: (row) => (
      <Link
        className="data-table__primary"
        params={{ claimId: row.id }}
        to="/club-claims/$claimId"
      >
        {row.club_name}
      </Link>
    ),
  }),
  dataColumn<ClubClaimSummary>({
    id: "kind",
    header: "Kind",
    sortValue: (row) => row.kind,
    cell: (row) => (row.kind === "claim" ? "Claim" : "New club request"),
  }),
  dataColumn<ClubClaimSummary>({
    id: "school",
    header: "School",
    sortValue: (row) => row.school.name,
    cell: (row) => (
      <Link params={{ schoolId: row.school.id }} to="/schools/$schoolId">
        {row.school.name}
      </Link>
    ),
  }),
  dataColumn<ClubClaimSummary>({
    id: "applicant",
    header: "Applicant",
    sortValue: (row) => row.applicant_name,
    cell: (row) => (
      <UserLink name={row.applicant_name} userId={row.applicant_user_id} />
    ),
  }),
  dataColumn<ClubClaimSummary>({
    id: "status",
    header: "Status",
    sortValue: (row) => row.status,
    cell: (row) => <StateBadge state={row.status} />,
  }),
  dataColumn<ClubClaimSummary>({
    id: "created_at",
    header: "Submitted",
    sortValue: (row) => row.created_at,
    cell: (row) => <Timestamp value={row.created_at} />,
  }),
];

function ClubClaimsPage() {
  const page = Route.useLoaderData();
  const search = Route.useSearch();

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Moderation</p>
          <h1>Club claims</h1>
          <p>
            Officers asking to manage a listed club, or to add one that is not
            listed. Open one to check the evidence, then approve or reject it.
          </p>
        </div>
        <span className="count-badge">{page.claims.length} on this page</span>
      </header>

      <CatalogFilters
        action="/club-claims"
        search={search}
        states={catalogListKinds.club_claims}
      />

      {page.claims.length ? (
        <DataTable
          columns={claimColumns}
          data={page.claims}
          getRowId={(claim) => claim.id}
          label="Club claims"
          rowHeader="club"
        />
      ) : (
        <section className="empty-panel">
          <h2>No claims match this filter</h2>
          <p>Choose another status, or clear the filter.</p>
        </section>
      )}

      <CursorPagination
        label="Club claim pages"
        path="/club-claims"
        search={search}
        previousCursor={page.previous_cursor}
        nextCursor={page.next_cursor}
      />
    </div>
  );
}
