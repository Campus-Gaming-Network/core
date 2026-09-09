import {
  HeadContent,
  Link,
  Outlet,
  Scripts,
  useRouter,
  createRootRoute,
  type ErrorComponentProps
} from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent, type ReactNode } from "react";
import {
  getEventViewerSession,
  logout
} from "../features/event-slice/auth.functions";
import { getPublicSiteOrigin } from "../server/public-origin.functions";
import appCSS from "../styles.css?url";

const siteName = "Campus Gaming Network";
const siteDescription =
  "Find campus gaming events, teams, and school activity.";

export const Route = createRootRoute({
  beforeLoad: async () => {
    const [viewerSession, publicOrigin] = await Promise.all([
      getEventViewerSession(),
      getPublicSiteOrigin()
    ]);

    return { viewerSession, publicOrigin };
  },
  loader: ({ context }) => ({
    navigation: {
      authenticated: context.viewerSession.status === "authenticated",
      hasSessionCookie: context.viewerSession.hasSessionCookie
    },
    publicOrigin: context.publicOrigin
  }),
  headers: ({ loaderData }) => ({
    "cache-control": loaderData?.navigation.hasSessionCookie
      ? "private, no-store"
      : "public, max-age=0, must-revalidate",
    vary: "Cookie"
  }),
  head: ({ loaderData }) => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: siteName },
      { name: "description", content: siteDescription },
      { name: "application-name", content: siteName },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: siteName },
      { property: "og:title", content: siteName },
      { property: "og:description", content: siteDescription },
      {
        property: "og:url",
        content: loaderData?.publicOrigin ?? "http://localhost:3100"
      },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: siteName },
      { name: "twitter:description", content: siteDescription }
    ],
    links: [{ rel: "stylesheet", href: appCSS }]
  }),
  component: RootComponent,
  errorComponent: RootError,
  notFoundComponent: RootNotFound,
  shellComponent: RootDocument
});

function RootComponent() {
  const { navigation } = Route.useLoaderData();

  return (
    <>
      <header className="site-header">
        <Link className="brand" to="/">
          Campus Gaming Network
        </Link>
        <nav aria-label="Main navigation">
          <a href="/schools">Schools</a>
          <a href="/events">Events</a>
          <a href="/teams">Teams</a>
          <a href="/faq">FAQ</a>
          <AuthNavigation authenticated={navigation.authenticated} />
        </nav>
      </header>
      <Outlet />
      <footer className="site-footer">
        <a href="/about">About</a>
        <a href="/support">Support</a>
        <a href="/terms">Terms</a>
        <a href="/privacy">Privacy</a>
      </footer>
    </>
  );
}

function AuthNavigation({ authenticated }: { authenticated: boolean }) {
  const runLogout = useServerFn(logout);
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);

    try {
      await runLogout();
      await router.invalidate();
      await router.navigate({ href: "/", replace: true });
    } finally {
      setPending(false);
    }
  }

  if (!authenticated) {
    return (
      <>
        <Link to="/login">Log in</Link>
        <a className="button button--primary" href="/signup">
          Sign up
        </a>
      </>
    );
  }

  return (
    <>
      <a href="/account">Account</a>
      <form action={logout.url} method="post" onSubmit={submit}>
        <button type="submit" disabled={pending}>
          {pending ? "Logging out…" : "Log out"}
        </button>
      </form>
    </>
  );
}

function RootError({ reset }: ErrorComponentProps) {
  const router = useRouter();

  async function retry() {
    try {
      await router.invalidate();
    } finally {
      reset();
    }
  }

  return (
    <main className="narrow">
      <p className="eyebrow">Something went wrong</p>
      <h1>We could not load this page.</h1>
      <p className="lede">
        This is usually temporary. Try again, and contact support if it keeps
        happening.
      </p>
      <div className="actions">
        <button type="button" onClick={() => void retry()}>
          Try again
        </button>
        <Link to="/">Go home</Link>
        <a href="/support">Contact support</a>
      </div>
    </main>
  );
}

function RootNotFound() {
  return (
    <main className="narrow">
      <title>Page not found | Campus Gaming Network</title>
      <meta name="robots" content="noindex,nofollow" />
      <p className="eyebrow">404</p>
      <h1>We could not find that page.</h1>
      <p className="lede">
        The link may be broken, or the event, team, or school may have been
        removed.
      </p>
      <div className="actions">
        <Link to="/">Go home</Link>
        <a href="/events">Browse events</a>
        <a href="/schools">Browse schools</a>
        <a href="/teams">Browse teams</a>
      </div>
    </main>
  );
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
