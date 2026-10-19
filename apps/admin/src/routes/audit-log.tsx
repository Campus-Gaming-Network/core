import { Timestamp } from "../components/timestamp";
import { Link, createFileRoute } from "@tanstack/react-router";
import { DataTable, dataColumn } from "../components/data-table";
import { UserLink } from "../components/user-link";
import { getAuditLog } from "../features/audit-log/audit-log.functions";
import {
  auditLogActionLabels,
  auditLogEntityLabels,
  validateAuditLogSearch,
  type AuditLogEntry,
} from "../features/audit-log/contracts";

export const Route = createFileRoute("/audit-log")({
  validateSearch: validateAuditLogSearch,
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => getAuditLog({ data: deps }),
  staleTime: 0,
  head: () => ({ meta: [{ title: "Audit log | CGN Admin Console" }] }),
  component: AuditLogPage,
});

// Reports and support tickets have no name, so their kind stands in for one.
function recordLabel(entry: AuditLogEntry): string {
  if (entry.target_type === "report") return "Report";
  if (entry.target_type === "support_ticket") return "Support ticket";
  return entry.target_name ?? "Removed record";
}

function RecordLink({ entry }: { entry: AuditLogEntry }) {
  const label = recordLabel(entry);
  const id = entry.target_id;
  if (!id) return label;
  switch (entry.target_type) {
    case "report":
      return (
        <Link
          className="entity-link"
          params={{ reportId: id }}
          to="/reports/$reportId"
        >
          {label}
        </Link>
      );
    case "support_ticket":
      return (
        <Link
          className="entity-link"
          params={{ ticketId: id }}
          to="/support-tickets/$ticketId"
        >
          {label}
        </Link>
      );
    case "school":
      return (
        <Link
          className="entity-link"
          params={{ schoolId: id }}
          to="/schools/$schoolId"
        >
          {label}
        </Link>
      );
    case "game":
      return (
        <Link
          className="entity-link"
          params={{ gameId: id }}
          to="/games/$gameId"
        >
          {label}
        </Link>
      );
    case "user":
      return <UserLink name={label} userId={id} />;
    case "club":
      return (
        <Link
          className="entity-link"
          params={{ clubId: id }}
          to="/clubs/$clubId"
        >
          {label}
        </Link>
      );
  }
}

const auditLogColumns = [
  dataColumn<AuditLogEntry>({
    id: "created_at",
    header: "When",
    sortValue: (row) => row.created_at,
    cell: (row) => <Timestamp value={row.created_at} />,
  }),
  dataColumn<AuditLogEntry>({
    id: "action",
    header: "Change",
    sortValue: (row) => auditLogActionLabels[row.action],
  }),
  dataColumn<AuditLogEntry>({
    id: "record",
    header: "Record",
    sortValue: recordLabel,
    cell: (row) => <RecordLink entry={row} />,
  }),
  dataColumn<AuditLogEntry>({
    id: "actor",
    header: "Changed by",
    sortValue: (row) => row.actor_name ?? "System",
    cell: (row) => (
      <UserLink
        fallback="System"
        name={row.actor_name}
        userId={row.actor_user_id}
      />
    ),
  }),
  dataColumn<AuditLogEntry>({
    id: "changed_fields",
    header: "Fields changed",
    sortValue: (row) =>
      row.changed_fields
        .map((field) => field.replaceAll("_", " "))
        .join(", ") || "—",
  }),
  dataColumn<AuditLogEntry>({
    id: "reason",
    header: "Reason",
    sortValue: (row) => row.reason || "—",
  }),
];

function AuditLogPage() {
  const page = Route.useLoaderData();
  const search = Route.useSearch();

  function pageURL(direction: "after" | "before", cursor: string) {
    const query = new URLSearchParams();
    if (search.entity_type) query.set("entity_type", search.entity_type);
    query.set(direction, cursor);
    return `/audit-log?${query.toString()}`;
  }

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Access</p>
          <h1>Audit log</h1>
          <p>
            Every administrative change made through the Admin Console, newest
            first. Open a record to see its own history.
          </p>
        </div>
        <span className="count-badge">
          {page.audit_entries.length} on this page
        </span>
      </header>

      <form action="/audit-log" className="filter-panel" method="get">
        <label>
          Changes to
          <select defaultValue={search.entity_type ?? ""} name="entity_type">
            <option value="">Everything</option>
            {Object.entries(auditLogEntityLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <div className="filter-actions">
          <button type="submit">Filter</button>
          <a className="secondary-button" href="/audit-log">
            Clear
          </a>
        </div>
      </form>

      {page.audit_entries.length ? (
        <DataTable
          columns={auditLogColumns}
          data={page.audit_entries}
          getRowId={(entry) => entry.id}
          label="Audit log"
        />
      ) : (
        <section className="empty-panel">
          <h2>No administrative changes match this filter</h2>
          <p>Clear the filter to see every recorded change.</p>
        </section>
      )}

      <nav className="pagination" aria-label="Audit log pages">
        {page.previous_cursor ? (
          <a href={pageURL("before", page.previous_cursor)}>Newer</a>
        ) : (
          <span />
        )}
        {page.next_cursor ? (
          <a href={pageURL("after", page.next_cursor)}>Older</a>
        ) : (
          <span />
        )}
      </nav>
    </div>
  );
}
