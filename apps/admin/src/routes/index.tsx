import { Link, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [{ title: "Overview | CGN Admin Console" }],
  }),
  component: AdminOverview,
});

function AdminOverview() {
  const { admin } = Route.useRouteContext();
  if (admin.status !== "authenticated") return null;

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Control plane</p>
          <h1>Admin overview</h1>
          <p>
            The secure shell is ready. Operational workflows will arrive as
            their capability-scoped API endpoints are completed.
          </p>
        </div>
        <span className="status-pill">Session active</span>
      </header>

      <section className="summary-grid" aria-label="Admin Console status">
        <article className="summary-card">
          <span>Role</span>
          <strong>Site administrator</strong>
        </article>
        <article className="summary-card">
          <span>Capabilities</span>
          <strong>{admin.session.capabilities.length}</strong>
        </article>
        <article className="summary-card">
          <span>Session expires</span>
          <strong>
            {new Intl.DateTimeFormat("en", {
              dateStyle: "medium",
              timeStyle: "short",
            }).format(new Date(admin.session.absolute_expires_at))}
          </strong>
        </article>
      </section>

      <section aria-labelledby="workspace-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Operations</p>
            <h2 id="workspace-heading">Moderation workspace</h2>
          </div>
        </div>
        <div className="workspace-grid">
          {admin.session.capabilities.includes("reports.read") ? (
            <Link className="workspace-card" to="/reports">
              <span>Safety</span>
              <strong>Review reports</strong>
              <small>Filter, assign, resolve, and inspect audit history.</small>
            </Link>
          ) : null}
          {admin.session.capabilities.includes("support.read") ? (
            <Link className="workspace-card" to="/support-tickets">
              <span>Support</span>
              <strong>Review support tickets</strong>
              <small>Handle requests with scoped access to contact data.</small>
            </Link>
          ) : null}
        </div>
      </section>
    </div>
  );
}
