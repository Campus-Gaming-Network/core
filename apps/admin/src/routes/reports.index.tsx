import { Link, createFileRoute } from "@tanstack/react-router";
import {
  QueueFilters,
  QueuePagination,
  QueueStatusBadge,
  formatTimestamp,
} from "../features/moderation/moderation-components";
import { UserLink } from "../components/user-link";
import { DataTable, dataColumn } from "../components/data-table";
import {
  validateOpenQueueSearch,
  type ReportSummary,
} from "../features/moderation/contracts";
import { getReportQueue } from "../features/moderation/moderation.functions";

export const Route = createFileRoute("/reports/")({
  validateSearch: validateOpenQueueSearch,
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => getReportQueue({ data: deps }),
  staleTime: 0,
  head: () => ({
    meta: [{ title: "Reports | CGN Admin Console" }],
  }),
  component: ReportsPage,
});

const reportColumns = [
  dataColumn<ReportSummary>({
    id: "target_type",
    header: "Type",
    sortValue: (row) => row.target_type,
    cell: (row) => (
      <Link
        className="data-table__primary"
        params={{ reportId: row.id }}
        to="/reports/$reportId"
      >
        {row.target_type}
      </Link>
    ),
  }),
  dataColumn<ReportSummary>({
    id: "target",
    header: "Target",
    sortValue: (row) => row.target_name ?? "Unknown",
  }),
  dataColumn<ReportSummary>({
    id: "status",
    header: "Status",
    sortValue: (row) => row.status,
    cell: (row) => <QueueStatusBadge status={row.status} />,
  }),
  dataColumn<ReportSummary>({
    id: "reporter",
    header: "Reporter",
    sortValue: (row) => row.reporter_name ?? "Unknown",
    cell: (row) => (
      <UserLink name={row.reporter_name} userId={row.reporter_user_id} />
    ),
  }),
  dataColumn<ReportSummary>({
    id: "assigned_to",
    header: "Assigned to",
    sortValue: (row) => row.assigned_to_name ?? "Unassigned",
    cell: (row) => (
      <UserLink
        fallback="Unassigned"
        name={row.assigned_to_name}
        userId={row.assigned_to_user_id}
      />
    ),
  }),
  dataColumn<ReportSummary>({
    id: "created_at",
    header: "Created",
    sortValue: (row) => row.created_at,
    cell: (row) => (
      <time dateTime={row.created_at}>{formatTimestamp(row.created_at)}</time>
    ),
  }),
];

function ReportsPage() {
  const reports = Route.useLoaderData();
  const search = Route.useSearch();

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Moderation</p>
          <h1>Reports</h1>
          <p>
            Reports users have filed about events and other users. Open one to
            read it, assign it, and record the outcome.
          </p>
        </div>
        <span className="count-badge">
          {reports.reports.length} on this page
        </span>
      </header>

      <QueueFilters
        action="/reports"
        operators={reports.operators}
        search={search}
      />

      {reports.reports.length ? (
        <DataTable
          columns={reportColumns}
          data={reports.reports}
          getRowId={(report) => report.id}
          label="Report queue"
        />
      ) : (
        <section className="empty-panel">
          <h2>No reports match these filters</h2>
          <p>Clear the filters or check another workflow status.</p>
        </section>
      )}

      <QueuePagination
        path="/reports"
        search={search}
        previousCursor={reports.previous_cursor}
        nextCursor={reports.next_cursor}
      />
    </div>
  );
}
