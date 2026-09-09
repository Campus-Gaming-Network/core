import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: MigrationHome
});

function MigrationHome() {
  return (
    <main>
      <p className="eyebrow">Migration spike</p>
      <h1>Campus Gaming Network on TanStack Start</h1>
      <p>
        This parallel application is the reversible Phase 1 proving ground. The
        current Next.js frontend remains available on port 3000.
      </p>
      <p>
        <a href="/api/health">Check the web-to-API health boundary</a>
      </p>
    </main>
  );
}
