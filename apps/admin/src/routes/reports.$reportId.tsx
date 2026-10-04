import { Link, createFileRoute } from "@tanstack/react-router";
import { UserLink } from "../components/user-link";
import { CopyIdButton } from "../components/copy-id-button";
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
  const { report, audit, operators, targetURL } = Route.useLoaderData();
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
          <p className="eyebrow">
            {report.target_type === "event" ? "Event report" : "User report"}
          </p>
          <h1>{report.target_name ?? `Unknown ${report.target_type}`}</h1>
          <CopyIdButton entity="report" id={report.id} />
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
            <UserLink
              name={report.reporter_name}
              userId={report.reporter_user_id}
            />
          </DetailFact>
          <DetailFact label="Target">
            {report.target_type === "user" ? (
              <UserLink name={report.target_name} userId={report.target_id} />
            ) : targetURL ? (
              <a
                className="entity-link"
                href={targetURL}
                rel="noreferrer"
                target="_blank"
              >
                {report.target_name ?? "View event"}
              </a>
            ) : (
              (report.target_name ?? `Unknown ${report.target_type}`)
            )}
          </DetailFact>
          <DetailFact label="Assignee">
            <UserLink
              fallback="Unassigned"
              name={report.assigned_to_name}
              userId={report.assigned_to_user_id}
            />
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
          operators={operators}
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
