import { adminTitle } from "../components/page-title";
import { Timestamp } from "../components/timestamp";
import { createFileRoute } from "@tanstack/react-router";
import { DetailFact } from "../features/moderation/moderation-components";
import {
  systemCheckLabels,
  systemStatusLabels,
  type SystemStatus,
} from "../features/system/contracts";
import { getSystem } from "../features/system/system.functions";

export const Route = createFileRoute("/system")({
  loader: () => getSystem(),
  staleTime: 0,
  head: () => ({ meta: [{ title: adminTitle("System") }] }),
  component: SystemPage,
});

const statusClasses: Record<SystemStatus["checks"][number]["status"], string> =
  {
    ok: "queue-status record-state--active",
    unreachable: "queue-status record-state--deleted",
    not_configured: "queue-status",
  };

function SystemPage() {
  const system = Route.useLoaderData();
  const outbox = system.email_outbox;

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Operations</p>
          <h1>System</h1>
          <p>
            Whether the services this site depends on are answering, and how
            much email is waiting to be sent. Checked each time this page loads.
          </p>
        </div>
      </header>

      <section className="detail-panel" aria-labelledby="dependencies-heading">
        <div className="panel-heading">
          <h2 id="dependencies-heading">Dependencies</h2>
        </div>
        <dl className="detail-facts">
          {system.checks.map((check) => (
            <DetailFact key={check.name} label={systemCheckLabels[check.name]}>
              <span className={statusClasses[check.status]}>
                {systemStatusLabels[check.status]}
              </span>
            </DetailFact>
          ))}
        </dl>
      </section>

      <section aria-labelledby="outbox-heading">
        <div className="section-heading">
          <h2 id="outbox-heading">Email outbox</h2>
        </div>
        <div className="summary-grid">
          <div className="summary-card">
            <span>Waiting to send</span>
            <strong>{outbox.pending}</strong>
          </div>
          <div className="summary-card">
            <span>Being retried</span>
            <strong>{outbox.retrying}</strong>
          </div>
          <div className="summary-card">
            <span>Failed in the last 7 days</span>
            <strong>{outbox.failed}</strong>
          </div>
        </div>
        <p className="empty-copy">
          {outbox.oldest_pending_at ? (
            <>
              Oldest waiting message queued{" "}
              <Timestamp value={outbox.oldest_pending_at} />.
            </>
          ) : (
            "No email is waiting."
          )}
        </p>
      </section>
    </div>
  );
}
