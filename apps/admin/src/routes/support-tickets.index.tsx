import { Link, createFileRoute } from "@tanstack/react-router";
import {
  QueueFilters,
  QueuePagination,
  QueueStatusBadge,
  formatTimestamp,
} from "../features/moderation/moderation-components";
import { validateQueueSearch } from "../features/moderation/contracts";
import { getSupportQueue } from "../features/moderation/moderation.functions";

export const Route = createFileRoute("/support-tickets/")({
  validateSearch: validateQueueSearch,
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => getSupportQueue({ data: deps }),
  staleTime: 0,
  head: () => ({
    meta: [{ title: "Support tickets | CGN Admin Console" }],
  }),
  component: SupportTicketsPage,
});

function SupportTicketsPage() {
  const tickets = Route.useLoaderData();
  const search = Route.useSearch();

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Operations</p>
          <h1>Support tickets</h1>
          <p>
            Triage account and product requests while keeping contact details
            and full messages out of queue responses.
          </p>
        </div>
        <span className="count-badge">
          {tickets.support_tickets.length} on this page
        </span>
      </header>

      <QueueFilters action="/support-tickets" search={search} />

      {tickets.support_tickets.length ? (
        <section className="queue-list" aria-label="Support ticket queue">
          {tickets.support_tickets.map((ticket) => (
            <Link
              className="queue-card"
              key={ticket.id}
              params={{ ticketId: ticket.id }}
              to="/support-tickets/$ticketId"
            >
              <span className="queue-card__topline">
                <strong>{ticket.subject}</strong>
                <QueueStatusBadge status={ticket.status} />
              </span>
              <span>
                Submitter{" "}
                <code>{ticket.submitter_user_id ?? "Deleted user"}</code>
              </span>
              <span className="queue-card__meta">
                {ticket.assigned_to_user_id
                  ? `Assigned to ${ticket.assigned_to_user_id}`
                  : "Unassigned"}
                {" · "}
                <time dateTime={ticket.created_at}>
                  {formatTimestamp(ticket.created_at)}
                </time>
              </span>
            </Link>
          ))}
        </section>
      ) : (
        <section className="empty-panel">
          <h2>No support tickets match these filters</h2>
          <p>Clear the filters or check another workflow status.</p>
        </section>
      )}

      <QueuePagination
        path="/support-tickets"
        search={search}
        previousCursor={tickets.previous_cursor}
        nextCursor={tickets.next_cursor}
      />
    </div>
  );
}
