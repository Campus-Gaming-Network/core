import { Timestamp } from "../components/timestamp";
import { Link, createFileRoute } from "@tanstack/react-router";
import { CopyIdButton } from "../components/copy-id-button";
import {
  CatalogAuditPanel,
  CatalogNoticeView,
  CommandForm,
  StateBadge,
} from "../features/catalog/catalog-components";
import { getUserDetail } from "../features/catalog/catalog.functions";
import {
  hasRecentStepUp,
  validateCatalogDetailSearch,
} from "../features/catalog/contracts";
import { DataTable, dataColumn } from "../components/data-table";
import { UserLink } from "../components/user-link";
import type { ReportSummary } from "../features/moderation/contracts";
import {
  DetailFact,
  QueueStatusBadge,
} from "../features/moderation/moderation-components";

export const Route = createFileRoute("/users/$userId")({
  validateSearch: validateCatalogDetailSearch,
  loaderDeps: ({ search }) => ({
    audit_after: search.audit_after,
    audit_before: search.audit_before,
  }),
  loader: ({ context, params, deps }) =>
    getUserDetail({
      data: {
        id: params.userId,
        ...deps,
        include_reports:
          context.admin.status === "authenticated" &&
          context.admin.session.capabilities.includes("reports.read"),
      },
    }),
  staleTime: 0,
  head: () => ({ meta: [{ title: "User detail | CGN Admin Console" }] }),
  component: UserDetailPage,
});

const reportColumns = [
  dataColumn<ReportSummary>({
    id: "created_at",
    header: "Filed",
    sortValue: (row) => row.created_at,
    cell: (row) => (
      <Link
        className="data-table__primary"
        params={{ reportId: row.id }}
        to="/reports/$reportId"
      >
        <Timestamp value={row.created_at} />
      </Link>
    ),
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
];

function UserDetailPage() {
  const { user, audit, reports } = Route.useLoaderData();
  const search = Route.useSearch();
  const { admin } = Route.useRouteContext();
  const session = admin.status === "authenticated" ? admin.session : undefined;
  const capabilities = session?.capabilities ?? [];
  const stepUpReady = hasRecentStepUp(session?.step_up_at, Date.now());
  const path = `/users/${encodeURIComponent(user.id)}`;
  const deleted = user.account_status === "deleted";
  const staffFaculty = user.verification_level === "staff_faculty";
  const canReadReports = capabilities.includes("reports.read");
  const canReadSupport = capabilities.includes("support.read");

  return (
    <div className="page-stack detail-page">
      <header className="detail-header">
        <div>
          <Link className="back-link" to="/users">
            ← Users
          </Link>
          <p className="eyebrow">Account</p>
          <h1>{user.name}</h1>
          <CopyIdButton entity="user" id={user.id} />
        </div>
        <StateBadge state={user.account_status} />
      </header>

      <CatalogNoticeView notice={search.notice} />

      <section className="detail-panel" aria-labelledby="user-facts">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Current account</p>
            <h2 id="user-facts">Account summary</h2>
          </div>
        </div>
        <dl className="detail-facts">
          <DetailFact label="Email">{user.email}</DetailFact>
          <DetailFact label="Email verified">
            {user.email_verified_at ? (
              <Timestamp value={user.email_verified_at} />
            ) : (
              "Not verified"
            )}
          </DetailFact>
          <DetailFact label="Verification level">
            {user.verification_level.replaceAll("_", " ")}
          </DetailFact>
          <DetailFact label="Home school">
            {user.home_school_id ? (
              <Link
                params={{ schoolId: user.home_school_id }}
                to="/schools/$schoolId"
              >
                {user.home_school_name || "View school"}
              </Link>
            ) : (
              "None"
            )}
          </DetailFact>
          <DetailFact label="Site admin">
            {user.site_admin ? "Yes" : "No"}
          </DetailFact>
          <DetailFact label="School admin grants">
            {user.school_admin_count}
          </DetailFact>
          <DetailFact label="Last changed">
            <Timestamp value={user.updated_at} />
          </DetailFact>
        </dl>
      </section>

      {canReadReports || canReadSupport ? (
        <section className="detail-panel" aria-labelledby="related-queues">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Related activity</p>
              <h2 id="related-queues">Queues for this user</h2>
            </div>
          </div>
          <p className="field-help">Open a queue filtered to this account.</p>
          <div className="related-actions">
            {canReadSupport ? (
              <Link
                className="secondary-button"
                search={{ user: user.id, status: "all" }}
                to="/support-tickets"
              >
                View support tickets
              </Link>
            ) : null}
            {canReadReports ? (
              <Link
                className="secondary-button"
                search={{ user: user.id, status: "all" }}
                to="/reports"
              >
                View submitted reports
              </Link>
            ) : null}
          </div>
        </section>
      ) : null}

      {reports ? (
        <section className="detail-panel" aria-labelledby="reports-against">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Moderation</p>
              <h2 id="reports-against">Reports against this user</h2>
            </div>
            <span className="count-badge">{reports.length}</span>
          </div>
          {reports.length ? (
            <DataTable
              columns={reportColumns}
              data={reports}
              getRowId={(report) => report.id}
              label="Reports against this user"
            />
          ) : (
            <p className="field-help">Nobody has reported this account.</p>
          )}
        </section>
      ) : null}

      {!deleted &&
      (capabilities.includes("trust_grants.manage") ||
        capabilities.includes("users.manage_status") ||
        capabilities.includes("site_grants.manage")) ? (
        <section className="detail-panel" aria-labelledby="user-actions">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Actions</p>
              <h2 id="user-actions">Account actions</h2>
            </div>
          </div>

          {capabilities.includes("trust_grants.manage") ? (
            <CommandForm
              command="user.trust"
              description="Staff and faculty accounts show a visible role indicator. Removing it restores the email-derived level."
              expectedUpdatedAt={user.updated_at}
              id={user.id}
              returnPath={path}
              submitLabel="Update trust level"
              title="Staff or faculty"
            >
              <label>
                Staff or faculty
                <select
                  defaultValue={staffFaculty ? "true" : "false"}
                  name="staff_faculty"
                >
                  <option value="true">Staff or faculty</option>
                  <option value="false">Not staff or faculty</option>
                </select>
              </label>
            </CommandForm>
          ) : null}

          {capabilities.includes("users.manage_status") ? (
            user.account_status === "active" ? (
              <CommandForm
                command="user.suspend"
                description="Blocks sign-in and ends every public and admin session for this account."
                expectedUpdatedAt={user.updated_at}
                id={user.id}
                returnPath={path}
                stepUpReady={stepUpReady}
                submitLabel="Suspend account"
                title="Suspend"
              />
            ) : (
              <CommandForm
                command="user.reactivate"
                description="Lets the account sign in again."
                expectedUpdatedAt={user.updated_at}
                id={user.id}
                returnPath={path}
                stepUpReady={stepUpReady}
                submitLabel="Reactivate account"
                title="Reactivate"
              />
            )
          ) : null}

          {capabilities.includes("site_grants.manage") ? (
            user.site_admin ? (
              <p className="field-help">
                This account is a site admin. Revoke access from{" "}
                <Link to="/access/site-admins">Site admins</Link>.
              </p>
            ) : (
              <CommandForm
                command="site_grant.grant"
                description="Gives this account the full Admin Console. It must be active and email-verified."
                expectedUpdatedAt={user.updated_at}
                hiddenFields={{ user_id: user.id }}
                id={user.id}
                returnPath={path}
                stepUpReady={stepUpReady}
                submitLabel="Grant site-admin access"
                title="Site-admin access"
              />
            )
          ) : null}
        </section>
      ) : null}

      {capabilities.includes("audit.read") ? (
        <CatalogAuditPanel audit={audit} path={path} search={search} />
      ) : null}
    </div>
  );
}
