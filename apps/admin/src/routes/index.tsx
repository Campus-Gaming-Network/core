import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [{ title: "Overview | CGN Admin Console" }]
  }),
  component: AdminOverview
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
              timeStyle: "short"
            }).format(new Date(admin.session.absolute_expires_at))}
          </strong>
        </article>
      </section>

      <section className="empty-panel" aria-labelledby="workspace-heading">
        <p className="eyebrow">Next milestone</p>
        <h2 id="workspace-heading">Moderation and audit workspace</h2>
        <p>
          Report, support, and audit screens remain intentionally unavailable
          until their server-enforced read and mutation endpoints are ready.
        </p>
      </section>
    </div>
  );
}
