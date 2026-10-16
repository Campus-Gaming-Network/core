import {
  Link,
  useLocation,
  useParams,
  useRouter,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { siteName } from "./public-page-head";
import { slugSearchWords } from "./slug-search";

type RoutePendingProps = {
  message?: string;
};

type RouteErrorViewProps = Pick<ErrorComponentProps, "reset"> & {
  description?: string;
  eyebrow?: string;
  heading?: string;
  showNavigation?: boolean;
};

// Placeholders shaped like the redesigned pages (heading, filter row, compact
// directory rows) so any route can fall back to them. The message stays in the
// live region for screen readers; the placeholders are decorative.
export function RoutePending({ message = "Loading page…" }: RoutePendingProps) {
  return (
    <main className="route-pending" aria-busy="true" aria-live="polite">
      <h1 className="visually-hidden">{message}</h1>
      <div className="route-pending__shapes" aria-hidden="true">
        <div className="route-pending__bar route-pending__bar--title" />
        <div className="route-pending__bar route-pending__bar--lede" />
        <div className="route-pending__filters">
          <div className="route-pending__bar route-pending__bar--field" />
          <div className="route-pending__bar route-pending__bar--field" />
          <div className="route-pending__bar route-pending__bar--button" />
        </div>
        <div className="route-pending__list">
          {[0, 1, 2, 3].map((row) => (
            <div className="route-pending__row" key={row}>
              <div className="route-pending__bar route-pending__bar--tile" />
              <div className="route-pending__lines">
                <div className="route-pending__bar route-pending__bar--name" />
                <div className="route-pending__bar route-pending__bar--detail" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}

export function DefaultPending() {
  return <RoutePending />;
}

export function RouteErrorView({
  reset,
  description = "This is usually temporary. Try again, and contact support if it keeps happening.",
  eyebrow = "Something went wrong",
  heading = "We could not load this page.",
  showNavigation = true,
}: RouteErrorViewProps) {
  const router = useRouter();
  const [retrying, setRetrying] = useState(false);
  const [offline, setOffline] = useState(false);

  // Read after hydration so the server and first client render agree.
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  async function retry() {
    setRetrying(true);
    try {
      await router.invalidate();
    } finally {
      reset();
      setRetrying(false);
    }
  }

  const retryButton = (
    <button
      className="button button--primary"
      disabled={retrying}
      type="button"
      onClick={() => void retry()}
    >
      {retrying ? "Trying again…" : "Try again"}
    </button>
  );

  return (
    <main className="route-state">
      <section className="empty-state route-state__panel" role="alert">
        <title>{`${eyebrow} | ${siteName}`}</title>
        <meta name="robots" content="noindex,nofollow" />
        <p className="route-state__kicker">{eyebrow}</p>
        <h1>{heading}</h1>
        <p>
          {offline
            ? "You appear to be offline. Check your connection, then try again."
            : description}
        </p>
        <div className="actions">
          {retryButton}
          {showNavigation ? (
            <>
              <Link className="button button--secondary" to="/">
                Go home
              </Link>
              <Link to="/support">Contact support</Link>
            </>
          ) : null}
        </div>
      </section>
    </main>
  );
}

// A list whose API request failed, kept distinct from an empty result so an
// outage never reads as "nothing here". Retrying reloads the same URL, so it
// also works without JavaScript.
export function ListUnavailable({ heading }: { heading: string }) {
  const href = useLocation({ select: (location) => location.href });

  return (
    <section className="empty-state" role="alert">
      <h2>{heading}</h2>
      <p>
        This is usually temporary. Try again in a moment, and contact support if
        it keeps happening.
      </p>
      <div className="actions">
        <a className="button button--primary" href={href}>
          Try again
        </a>
        <Link to="/support">Contact support</Link>
      </div>
    </section>
  );
}

export function DefaultError({ reset }: ErrorComponentProps) {
  return <RouteErrorView reset={reset} />;
}

type NotFoundViewProps = {
  description: string;
  heading: string;
  /** The tab title, without the site name. */
  title?: string;
  actions: ReactNode;
};

// The page for a URL that matched no record. The site shell stays around it
// and the response is a 404, so this only adds the document head, the words,
// and the next steps.
function NotFoundView({
  actions,
  description,
  heading,
  title: pageTitle = "Page not found",
}: NotFoundViewProps) {
  const title = `${pageTitle} | ${siteName}`;

  return (
    <main className="route-state">
      <section className="empty-state route-state__panel">
        <title>{title}</title>
        <meta name="description" content={description} />
        <meta name="robots" content="noindex,nofollow" />
        <meta property="og:type" content="website" />
        <meta property="og:site_name" content={siteName} />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        <meta name="twitter:card" content="summary" />
        <meta name="twitter:title" content={title} />
        <meta name="twitter:description" content={description} />
        <p className="route-state__kicker">404</p>
        <h1>{heading}</h1>
        <p>{description}</p>
        <div className="actions">{actions}</div>
      </section>
    </main>
  );
}

export function DefaultNotFound() {
  return (
    <NotFoundView
      heading="We could not find that page."
      description="The link may be broken or out of date, or the page may have moved. These places may help."
      actions={
        <>
          <Link className="button button--primary" to="/">
            Go home
          </Link>
          <Link className="button button--secondary" to="/events">
            Browse events
          </Link>
          <Link to="/schools">Browse schools</Link>
          <Link to="/teams">Browse teams</Link>
        </>
      }
    />
  );
}

// An event, team, or school address that matched nothing. The slug comes from
// the URL, so a school link carries its words into the school search.
export function RecordNotFound({
  kind,
}: {
  kind: "event" | "school" | "team";
}) {
  const slug = useParams({
    strict: false,
    select: (params) => (typeof params.slug === "string" ? params.slug : ""),
  });
  const q = slugSearchWords(slug);

  if (kind === "event") {
    return (
      <NotFoundView
        title="Event not found"
        heading="We could not find that event."
        description="The link may be broken, or the event may have been removed or made private. Browse upcoming events to find it."
        actions={
          <>
            <Link className="button button--primary" to="/events">
              Browse events
            </Link>
            <Link className="button button--secondary" to="/">
              Go home
            </Link>
          </>
        }
      />
    );
  }

  if (kind === "team") {
    return (
      <NotFoundView
        title="Team not found"
        heading="We could not find that team."
        description="The link may be broken, or the team may have been removed. Browse teams to find it."
        actions={
          <>
            <Link className="button button--primary" to="/teams">
              Browse teams
            </Link>
            <Link className="button button--secondary" to="/">
              Go home
            </Link>
          </>
        }
      />
    );
  }

  return (
    <NotFoundView
      title="School not found"
      heading="We could not find that school."
      description="The link may be broken, or the school may not be on Campus Gaming Network yet. Search schools to find it."
      actions={
        <>
          <Link
            className="button button--primary"
            to="/schools"
            search={q ? { q } : {}}
          >
            {q ? `Search schools for "${q}"` : "Browse schools"}
          </Link>
          <Link className="button button--secondary" to="/">
            Go home
          </Link>
        </>
      }
    />
  );
}
