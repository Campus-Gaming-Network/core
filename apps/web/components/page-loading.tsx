type PageLoadingProps = {
  /** Short label describing what is loading, e.g. "events". */
  label: string;
};

/**
 * Shared loading state for route-level loading.tsx files. Announced politely so
 * screen readers hear it without interrupting, and marked aria-busy so the
 * region reads as in-progress rather than empty.
 *
 * Do not add a loading.tsx to a segment that contains a route calling
 * notFound(). A loading.tsx creates a Suspense boundary over its whole subtree,
 * which makes the response stream and commit a 200 before the page can set a
 * 404 — turning every missing event, school, team, and profile into a soft 404.
 * That is why the browse pages live in a (browse) route group: it scopes their
 * loading boundary to the list page and keeps it off the [slug] detail routes.
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
