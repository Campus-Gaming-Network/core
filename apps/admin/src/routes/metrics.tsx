import { adminTitle } from "../components/page-title";
import { Link, createFileRoute } from "@tanstack/react-router";
import { DataTable, dataColumn } from "../components/data-table";
import { stickiness, type Metrics } from "../features/metrics/contracts";
import { getMetrics } from "../features/metrics/metrics.functions";

export const Route = createFileRoute("/metrics")({
  loader: () => getMetrics(),
  staleTime: 0,
  head: () => ({ meta: [{ title: adminTitle("Metrics") }] }),
  component: MetricsPage,
});

type Day = Metrics["days"][number];
type School = Metrics["schools"][number];

const dayColumns = [
  dataColumn<Day>({
    id: "day",
    header: "Day (UTC)",
    sortValue: (row) => row.day,
  }),
  dataColumn<Day>({
    id: "active",
    header: "Active accounts",
    sortValue: (row) => row.active,
  }),
  dataColumn<Day>({
    id: "signups",
    header: "New accounts",
    sortValue: (row) => row.signups,
  }),
];

const schoolColumns = [
  dataColumn<School>({
    id: "name",
    header: "Home school",
    sortValue: (row) => row.name,
    cell: (row) => (
      <Link
        className="data-table__primary"
        params={{ schoolId: row.id }}
        to="/schools/$schoolId"
      >
        {row.name}
      </Link>
    ),
  }),
  dataColumn<School>({
    id: "active",
    header: "Active accounts, last 30 days",
    sortValue: (row) => row.active,
  }),
];

function MetricsPage() {
  const metrics = Route.useLoaderData();
  const signups = metrics.days.reduce((total, day) => total + day.signups, 0);

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Operations</p>
          <h1>Metrics</h1>
          <p>
            Accounts that made a signed-in request, counted by UTC day through{" "}
            {metrics.as_of}. Today&apos;s count is the day so far. Anonymous
            visits are in Plausible.
          </p>
        </div>
      </header>

      <section aria-labelledby="active-heading">
        <div className="section-heading">
          <h2 id="active-heading">Active accounts</h2>
        </div>
        <div className="summary-grid">
          <div className="summary-card">
            <span>Today</span>
            <strong>{metrics.active.day}</strong>
          </div>
          <div className="summary-card">
            <span>Last 7 days</span>
            <strong>{metrics.active.week}</strong>
          </div>
          <div className="summary-card">
            <span>Last 30 days</span>
            <strong>{metrics.active.month}</strong>
          </div>
          <div className="summary-card">
            <span>Today ÷ last 30 days</span>
            <strong>{stickiness(metrics.active)}</strong>
          </div>
          <div className="summary-card">
            <span>New accounts, last 30 days</span>
            <strong>{signups}</strong>
          </div>
        </div>
      </section>

      <section aria-labelledby="days-heading">
        <div className="section-heading">
          <h2 id="days-heading">By day</h2>
        </div>
        <DataTable
          columns={dayColumns}
          data={metrics.days}
          getRowId={(row) => row.day}
          label="Active and new accounts by day"
        />
      </section>

      <section aria-labelledby="schools-heading">
        <div className="section-heading">
          <h2 id="schools-heading">By home school</h2>
        </div>
        {metrics.schools.length ? (
          <DataTable
            columns={schoolColumns}
            data={metrics.schools}
            getRowId={(row) => row.id}
            label="Active accounts by home school"
            rowHeader="name"
          />
        ) : (
          <p className="empty-copy">
            No account was active in the last 30 days.
          </p>
        )}
      </section>
    </div>
  );
}
