type PageLoadingProps = {
  /** Short label describing what is loading, e.g. "events". */
  label: string;
};

/**
 * Shared loading state for route-level loading.tsx files. Announced politely so
 * screen readers hear it without interrupting, and marked aria-busy so the
 * region reads as in-progress rather than empty.
 */
export function PageLoading({ label }: PageLoadingProps) {
  return (
    <main className="narrow">
      <section className="page-heading" aria-busy="true" aria-live="polite">
        <p className="eyebrow">Loading</p>
        <h1>Loading {label}…</h1>
        <p className="lede">One moment while we fetch the latest.</p>
      </section>
    </main>
  );
}
