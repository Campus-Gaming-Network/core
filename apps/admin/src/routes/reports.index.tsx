import { Link, createFileRoute } from "@tanstack/react-router";
import {
  QueueFilters,
  QueuePagination,
  QueueStatusBadge,
  formatTimestamp,
} from "../features/moderation/moderation-components";
import { validateQueueSearch } from "../features/moderation/contracts";
import { getReportQueue } from "../features/moderation/moderation.functions";

export const Route = createFileRoute("/reports/")({
  validateSearch: validateQueueSearch,
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => getReportQueue({ data: deps }),
  staleTime: 0,
  head: () => ({
    meta: [{ title: "Reports | CGN Admin Console" }],
  }),
  component: ReportsPage,
});

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
            Review user-submitted reports, assign an operator, and record the
            outcome without exposing report text in the queue response.
          </p>
        </div>
        <span className="count-badge">
          {reports.reports.length} on this page
        </span>
      </header>

      <QueueFilters action="/reports" search={search} />

      {reports.reports.length ? (
        <section className="queue-list" aria-label="Report queue">
          {reports.reports.map((report) => (
            <Link
              className="queue-card"
              key={report.id}
              params={{ reportId: report.id }}
              to="/reports/$reportId"
            >
              <span className="queue-card__topline">
                <strong>{report.target_type} report</strong>
                <QueueStatusBadge status={report.status} />
              </span>
              <span>
                Target <code>{report.target_id}</code>
              </span>
              <span>
                Reporter <code>{report.reporter_user_id}</code>
              </span>
              <span className="queue-card__meta">
                {report.assigned_to_user_id
                  ? `Assigned to ${report.assigned_to_user_id}`
                  : "Unassigned"}
                {" · "}
                <time dateTime={report.created_at}>
                  {formatTimestamp(report.created_at)}
                </time>
              </span>
            </Link>
          ))}
        </section>
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
