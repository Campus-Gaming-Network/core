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
  type SupportTicketSummary,
} from "../features/moderation/contracts";
import { getSupportQueue } from "../features/moderation/moderation.functions";

export const Route = createFileRoute("/support-tickets/")({
  validateSearch: validateOpenQueueSearch,
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => getSupportQueue({ data: deps }),
  staleTime: 0,
  head: () => ({
    meta: [{ title: "Support tickets | CGN Admin Console" }],
  }),
  component: SupportTicketsPage,
});

const ticketColumns = [
  dataColumn<SupportTicketSummary>({
    id: "subject",
    header: "Subject",
    sortValue: (row) => row.subject,
    cell: (row) => (
      <Link
        className="data-table__primary"
        params={{ ticketId: row.id }}
        to="/support-tickets/$ticketId"
      >
        {row.subject}
      </Link>
    ),
  }),
  dataColumn<SupportTicketSummary>({
    id: "status",
    header: "Status",
    sortValue: (row) => row.status,
    cell: (row) => <QueueStatusBadge status={row.status} />,
  }),
  dataColumn<SupportTicketSummary>({
    id: "submitter",
    header: "Submitter",
    sortValue: (row) =>
      row.submitter_name ??
      (row.submitter_user_id ? "Unknown" : "Deleted user"),

    cell: (row) =>
      row.submitter_user_id ? (
        <UserLink name={row.submitter_name} userId={row.submitter_user_id} />
      ) : (
        "Deleted user"
      ),
  }),
  dataColumn<SupportTicketSummary>({
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
  dataColumn<SupportTicketSummary>({
    id: "created_at",
    header: "Created",
    sortValue: (row) => row.created_at,
    cell: (row) => (
      <time dateTime={row.created_at}>{formatTimestamp(row.created_at)}</time>
    ),
  }),
];

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
            Account and product requests from users. Open one to read the
            message, assign it, and record the outcome.
          </p>
        </div>
        <span className="count-badge">
          {tickets.support_tickets.length} on this page
        </span>
      </header>

      <QueueFilters
        action="/support-tickets"
        operators={tickets.operators}
        search={search}
      />

      {tickets.support_tickets.length ? (
        <DataTable
          columns={ticketColumns}
          data={tickets.support_tickets}
          getRowId={(ticket) => ticket.id}
          label="Support ticket queue"
        />
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
