import {
  HeadContent,
  Link,
  Outlet,
  Scripts,
  useRouter,
  useRouterState,
  createRootRoute
} from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  useEffect,
  useState,
  type FormEvent,
  type ReactNode
} from "react";
import {
  DefaultError,
  DefaultNotFound,
  DefaultPending
} from "../components/route-boundaries";
import { logout } from "../features/event-slice/auth.functions";
import { getPublicSiteOrigin } from "../server/public-origin.functions";
import appCSS from "../styles.css?url";

const siteName = "Campus Gaming Network";

export const Route = createRootRoute({
  beforeLoad: async () => ({ publicOrigin: await getPublicSiteOrigin() }),
  loader: ({ context }) => ({
    publicOrigin: context.publicOrigin
  }),
  headers: () => ({
    "cache-control": "public, max-age=0, must-revalidate",
    vary: "Cookie"
  }),
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "application-name", content: siteName }
    ],
    links: [{ rel: "stylesheet", href: appCSS }]
  }),
  component: RootComponent,
  pendingComponent: DefaultPending,
  errorComponent: DefaultError,
  notFoundComponent: DefaultNotFound,
  shellComponent: RootDocument
});

function RootComponent() {
  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <header className="site-header">
        <Link className="brand" to="/">
          Campus Gaming Network
        </Link>
        <nav aria-label="Main navigation">
          <Link to="/schools">Schools</Link>
          <Link to="/events">Events</Link>
          <Link to="/teams">Teams</Link>
          <Link to="/faq">FAQ</Link>
          <AuthNavigation />
        </nav>
      </header>
      <MainContent />
      <footer className="site-footer">
        <Link to="/about">About</Link>
        <Link to="/support">Support</Link>
        <Link to="/terms">Terms</Link>
        <Link to="/privacy">Privacy</Link>
      </footer>
    </>
  );
}

function MainContent() {
  const router = useRouter();

  useEffect(
    () =>
      router.subscribe("onRendered", ({ pathChanged }) => {
        if (!pathChanged) return;
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const heading = document.querySelector<HTMLElement>(
              "#main-content h1"
            );
            heading?.setAttribute("tabindex", "-1");
            heading?.focus();
          });
        });
      }),
    [router]
  );

  return (
    <div id="main-content" tabIndex={-1}>
      <Outlet />
    </div>
  );
}

function AuthNavigation() {
  const runLogout = useServerFn(logout);
  const router = useRouter();
  const pathname = useRouterState({
    select: (state) => state.location.pathname
  });
  const [authenticated, setAuthenticated] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (authenticated) return;
    const controller = new AbortController();

    async function refreshAuthentication() {
      try {
        const response = await fetch("/api/navigation-session", {
          cache: "no-store",
          signal: controller.signal
        });
        if (!response.ok) return;
        const session: unknown = await response.json();
        setAuthenticated(
          typeof session === "object" &&
            session !== null &&
            "authenticated" in session &&
            session.authenticated === true
        );
      } catch {
        // Public navigation stays logged out if session discovery is unavailable.
      }
    }

    void refreshAuthentication();
    return () => controller.abort();
  }, [authenticated, pathname]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);

    try {
      await runLogout();
      setAuthenticated(false);
      await router.invalidate();
      await router.navigate({ to: "/", replace: true });
    } finally {
      setPending(false);
    }
  }

  if (!authenticated) {
    return (
      <>
        <Link to="/login">Log in</Link>
        <Link className="button button--primary" to="/signup">
          Sign up
        </Link>
      </>
    );
  }

  return (
    <>
      <Link to="/account">Account</Link>
      <form
        action={logout.url}
        className="logout-form"
        method="post"
        onSubmit={submit}
      >
        <button type="submit" disabled={pending}>
          {pending ? "Logging out…" : "Log out"}
        </button>
      </form>
    </>
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
