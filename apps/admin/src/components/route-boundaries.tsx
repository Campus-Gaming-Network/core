import {
  Link,
  useRouter,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { adminTitle } from "./page-title";

export function DefaultPending() {
  return (
    <main className="state-page" aria-busy="true" aria-live="polite">
      <title>{adminTitle("Loading")}</title>
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
      <title>{adminTitle("Something went wrong")}</title>
      <p className="eyebrow">Admin Console</p>
      <h1>We could not load this page.</h1>
      <p>The request failed safely. Try again or contact the site operator.</p>
      <button type="button" onClick={() => void retry()}>
        Try again
      </button>
      <Link className="back-link" to="/">
        Return to overview
      </Link>
    </main>
  );
}

export function DefaultNotFound() {
  return (
    <main className="state-page">
      <title>{adminTitle("Page not found")}</title>
      <p className="eyebrow">404</p>
      <h1>That admin page does not exist.</h1>
      <Link className="button" to="/">
        Return to overview
      </Link>
    </main>
  );
}
