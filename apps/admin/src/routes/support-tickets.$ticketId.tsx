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
import { getSupportDetail } from "../features/moderation/moderation.functions";

export const Route = createFileRoute("/support-tickets/$ticketId")({
  validateSearch: validateModerationDetailSearch,
  loaderDeps: ({ search }) => ({
    audit_after: search.audit_after,
    audit_before: search.audit_before,
  }),
  loader: ({ params, deps }) =>
    getSupportDetail({ data: { id: params.ticketId, ...deps } }),
  staleTime: 0,
  head: () => ({
    meta: [{ title: "Support ticket detail | CGN Admin Console" }],
  }),
  component: SupportTicketDetailPage,
});

function SupportTicketDetailPage() {
  const { ticket, audit } = Route.useLoaderData();
  const search = Route.useSearch();
  const { admin } = Route.useRouteContext();
  const canManage =
    admin.status === "authenticated" &&
    admin.session.capabilities.includes("support.manage");

  return (
    <div className="page-stack detail-page">
      <header className="detail-header">
        <div>
          <Link className="back-link" to="/support-tickets">
            ← Support tickets
          </Link>
          <p className="eyebrow">Support ticket</p>
          <h1>{ticket.subject}</h1>
          <p className="detail-id">
            <code>{ticket.id}</code>
          </p>
        </div>
        <QueueStatusBadge status={ticket.status} />
      </header>

      <DetailNotice notice={search.notice} />

      <section className="detail-panel" aria-labelledby="ticket-heading">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Submitted request</p>
            <h2 id="ticket-heading">Contact and message</h2>
          </div>
        </div>
        <dl className="detail-facts">
          <DetailFact label="Submitter">
            <code>{ticket.submitter_user_id ?? "Deleted user"}</code>
          </DetailFact>
          <DetailFact label="Contact name">
            {ticket.name || "Not provided"}
          </DetailFact>
          <DetailFact label="Contact email">{ticket.contact_email}</DetailFact>
          <DetailFact label="Submitted">
            <time dateTime={ticket.created_at}>
              {formatTimestamp(ticket.created_at)}
            </time>
          </DetailFact>
          <DetailFact label="Retention started">
            {ticket.retention_started_at ? (
              <time dateTime={ticket.retention_started_at}>
                {formatTimestamp(ticket.retention_started_at)}
              </time>
            ) : (
              "Not started"
            )}
          </DetailFact>
        </dl>
        <div className="stored-content">
          <h3>Message</h3>
          <p>{ticket.message}</p>
        </div>
      </section>

      {canManage ? (
        <QueueMutationForm
          key={ticket.updated_at}
          kind="support-ticket"
          item={ticket}
        />
      ) : (
        <p className="notice">You have read-only access to support tickets.</p>
      )}

      <AuditPanel
        audit={audit}
        path={`/support-tickets/${encodeURIComponent(ticket.id)}`}
        search={search}
      />
    </div>
  );
}
