import { Link, createFileRoute } from "@tanstack/react-router";
import type { QueueCounts } from "../features/moderation/contracts";
import { getQueueCounts } from "../features/moderation/moderation.functions";

export const Route = createFileRoute("/")({
  loader: ({ context }) =>
    context.admin.status === "authenticated"
      ? getQueueCounts({
          data: { capabilities: context.admin.session.capabilities },
        })
      : { reports: undefined, support: undefined },
  staleTime: 0,
  head: () => ({
    meta: [{ title: "Overview | CGN Admin Console" }],
  }),
  component: AdminOverview,
});

function AdminOverview() {
  const counts = Route.useLoaderData();

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Overview</p>
          <h1>Waiting work</h1>
          <p>Reports and support tickets that still need a decision.</p>
        </div>
      </header>

      {counts.reports ? (
        <QueueSummary counts={counts.reports} path="/reports" title="Reports" />
      ) : null}
      {counts.support ? (
        <QueueSummary
          counts={counts.support}
          path="/support-tickets"
          title="Support tickets"
        />
      ) : null}
      {!counts.reports && !counts.support ? (
        <section className="empty-panel">
          <h2>No queues to review</h2>
          <p>Your access does not include reports or support tickets.</p>
        </section>
      ) : null}
    </div>
  );
}

function QueueSummary({
  counts,
  path,
  title,
}: {
  counts: QueueCounts;
  path: "/reports" | "/support-tickets";
  title: string;
}) {
  const headingID = `${path.slice(1)}-summary`;
  return (
    <section aria-labelledby={headingID}>
      <div className="section-heading">
        <h2 id={headingID}>{title}</h2>
      </div>
      <div className="summary-grid">
        <Link className="summary-card" search={{ status: "open" }} to={path}>
          <span>Open</span>
          <strong>{counts.open}</strong>
        </Link>
        <Link
          className="summary-card"
          search={{ status: "in_review" }}
          to={path}
        >
          <span>In review</span>
          <strong>{counts.in_review}</strong>
        </Link>
        <Link
          className="summary-card"
          search={{ status: "open", assignee: "unassigned" }}
          to={path}
        >
          <span>Open and unassigned</span>
          <strong>{counts.unassigned}</strong>
        </Link>
      </div>
    </section>
  );
}
