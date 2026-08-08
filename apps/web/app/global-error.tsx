"use client";

import "./globals.css";

type GlobalErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

/**
 * Last-resort boundary for failures in the root layout itself. It replaces the
 * whole document, so it renders its own html and body and avoids importing
 * anything that the failing layout depends on.
 */
export default function GlobalError({ error, reset }: GlobalErrorProps) {
  return (
    <html lang="en">
      <body>
        <main className="narrow">
          <section className="page-heading">
            <p className="eyebrow">Something went wrong</p>
            <h1>Campus Gaming Network is having trouble loading.</h1>
            <p className="lede">
              This is usually temporary. Reload the page to try again.
            </p>
            {error.digest ? (
              <p className="form-help">Reference: {error.digest}</p>
            ) : null}
            <div className="actions">
              <button
                className="button button--primary"
                type="button"
                onClick={reset}
              >
                Try again
              </button>
              <a className="button button--secondary" href="/">
                Go home
              </a>
            </div>
          </section>
        </main>
      </body>
    </html>
  );
}
