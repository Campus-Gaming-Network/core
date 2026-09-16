import { Link, useRouter, type ErrorComponentProps } from "@tanstack/react-router";

export function DefaultPending() {
  return (
    <main className="state-page" aria-busy="true" aria-live="polite">
      <p className="eyebrow">Admin Console</p>
      <h1>Checking access…</h1>
    </main>
  );
}

export function DefaultError({ reset }: ErrorComponentProps) {
  const router = useRouter();
  async function retry() {
    try {
      await router.invalidate();
    } finally {
      reset();
    }
  }

  return (
    <main className="state-page">
      <p className="eyebrow">Admin Console</p>
      <h1>We could not load this page.</h1>
      <p>The request failed safely. Try again or contact the site operator.</p>
      <button type="button" onClick={() => void retry()}>
        Try again
      </button>
    </main>
  );
}

export function DefaultNotFound() {
  return (
    <main className="state-page">
      <title>Page not found | CGN Admin Console</title>
      <p className="eyebrow">404</p>
      <h1>That admin page does not exist.</h1>
      <Link className="button" to="/">
        Return to overview
      </Link>
    </main>
  );
}
