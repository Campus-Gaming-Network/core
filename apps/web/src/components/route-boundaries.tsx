import {
  Link,
  useRouter,
  type ErrorComponentProps
} from "@tanstack/react-router";

type RoutePendingProps = {
  message?: string;
};

type RouteErrorViewProps = Pick<ErrorComponentProps, "reset"> & {
  description?: string;
  eyebrow?: string;
  heading?: string;
  showNavigation?: boolean;
};

export function RoutePending({ message = "Loading page…" }: RoutePendingProps) {
  return (
    <main className="narrow" aria-busy="true" aria-live="polite">
      <p>{message}</p>
    </main>
  );
}

export function DefaultPending() {
  return <RoutePending />;
}

export function RouteErrorView({
  reset,
  description =
    "This is usually temporary. Try again, and contact support if it keeps happening.",
  eyebrow = "Something went wrong",
  heading = "We could not load this page.",
  showNavigation = true
}: RouteErrorViewProps) {
  const router = useRouter();

  async function retry() {
    try {
      await router.invalidate();
    } finally {
      reset();
    }
  }

  const retryButton = (
    <button type="button" onClick={() => void retry()}>
      Try again
    </button>
  );

  return (
    <main className="narrow">
      <p className="eyebrow">{eyebrow}</p>
      <h1>{heading}</h1>
      <p className="lede">{description}</p>
      {showNavigation ? (
        <div className="actions">
          {retryButton}
          <Link to="/">Go home</Link>
          <Link to="/support">Contact support</Link>
        </div>
      ) : (
        retryButton
      )}
    </main>
  );
}

export function DefaultError({ reset }: ErrorComponentProps) {
  return <RouteErrorView reset={reset} />;
}

export function DefaultNotFound() {
  const title = "Page not found | Campus Gaming Network";
  const description = "That page does not exist on Campus Gaming Network.";

  return (
    <main className="narrow">
      <title>{title}</title>
      <meta name="description" content={description} />
      <meta name="robots" content="noindex,nofollow" />
      <meta property="og:type" content="website" />
      <meta property="og:site_name" content="Campus Gaming Network" />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta name="twitter:card" content="summary" />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      <p className="eyebrow">404</p>
      <h1>We could not find that page.</h1>
      <p className="lede">
        The link may be broken, or the event, team, or school may have been
        removed.
      </p>
      <div className="actions">
        <Link to="/">Go home</Link>
        <Link to="/events">Browse events</Link>
        <Link to="/schools">Browse schools</Link>
        <Link to="/teams">Browse teams</Link>
      </div>
    </main>
  );
}
