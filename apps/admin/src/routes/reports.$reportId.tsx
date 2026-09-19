import { Link, createFileRoute } from "@tanstack/react-router";
import {
  AuditPanel,
  DetailFact,
  DetailNotice,
  QueueMutationForm,
  QueueStatusBadge,
  formatTimestamp,
} from "../features/moderation/moderation-components";
import { validateModerationDetailSearch } from "../features/moderation/contracts";
import { getReportDetail } from "../features/moderation/moderation.functions";

export const Route = createFileRoute("/reports/$reportId")({
  validateSearch: validateModerationDetailSearch,
  loaderDeps: ({ search }) => ({
    audit_after: search.audit_after,
    audit_before: search.audit_before,
  }),
  loader: ({ params, deps }) =>
    getReportDetail({ data: { id: params.reportId, ...deps } }),
  staleTime: 0,
  head: () => ({
    meta: [{ title: "Report detail | CGN Admin Console" }],
  }),
  component: ReportDetailPage,
});

function ReportDetailPage() {
  const { report, audit } = Route.useLoaderData();
  const search = Route.useSearch();
  const { admin } = Route.useRouteContext();
  const canManage =
    admin.status === "authenticated" &&
    admin.session.capabilities.includes("reports.manage");

  return (
    <div className="page-stack detail-page">
      <header className="detail-header">
        <div>
          <Link className="back-link" to="/reports">
            ← Reports
          </Link>
          <p className="eyebrow">Report detail</p>
          <h1>{report.target_type} report</h1>
          <p className="detail-id">
            <code>{report.id}</code>
          </p>
        </div>
        <QueueStatusBadge status={report.status} />
      </header>

      <DetailNotice notice={search.notice} />

      <section className="detail-panel" aria-labelledby="report-heading">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Submitted report</p>
            <h2 id="report-heading">Report information</h2>
          </div>
        </div>
        <dl className="detail-facts">
          <DetailFact label="Reporter">
            <code>{report.reporter_user_id}</code>
          </DetailFact>
          <DetailFact label="Target type">{report.target_type}</DetailFact>
          <DetailFact label="Target ID">
            <code>{report.target_id}</code>
          </DetailFact>
          <DetailFact label="Submitted">
            <time dateTime={report.created_at}>
              {formatTimestamp(report.created_at)}
            </time>
          </DetailFact>
          <DetailFact label="Retention started">
            {report.retention_started_at ? (
              <time dateTime={report.retention_started_at}>
                {formatTimestamp(report.retention_started_at)}
              </time>
            ) : (
              "Not started"
            )}
          </DetailFact>
        </dl>
        <div className="stored-content">
          <h3>Reason</h3>
          <p>{report.reason}</p>
        </div>
      </section>

      {canManage ? (
        <QueueMutationForm
          key={report.updated_at}
          kind="report"
          item={report}
        />
      ) : (
        <p className="notice">You have read-only access to reports.</p>
      )}

      <AuditPanel
        audit={audit}
        path={`/reports/${encodeURIComponent(report.id)}`}
        search={search}
      />
    </div>
  );
}
