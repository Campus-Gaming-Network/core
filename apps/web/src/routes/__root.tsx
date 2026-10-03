import {
  HeadContent,
  Link,
  Outlet,
  Scripts,
  useRouter,
  createRootRoute,
} from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { AccountMenu } from "../components/account-menu";
import { ViewerContext, type ViewerState } from "../components/viewer";
import {
  DefaultError,
  DefaultNotFound,
  DefaultPending,
} from "../components/route-boundaries";
import { logout } from "../features/event-slice/auth.functions";
import type { NavigationViewer } from "../features/event-slice/contracts";
import { getPublicSiteOrigin } from "../server/public-origin.functions";
import appCSS from "../styles.css?url";
import componentsCSS from "../components.css?url";

const siteName = "Campus Gaming Network";

export const Route = createRootRoute({
  beforeLoad: async () => ({ publicOrigin: await getPublicSiteOrigin() }),
  loader: ({ context }) => ({
    publicOrigin: context.publicOrigin,
  }),
  headers: () => ({
    "cache-control": "public, max-age=0, must-revalidate",
    vary: "Cookie",
  }),
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "application-name", content: siteName },
    ],
    links: [
      { rel: "stylesheet", href: appCSS },
      { rel: "stylesheet", href: componentsCSS },
    ],
  }),
  component: RootComponent,
  pendingComponent: DefaultPending,
  errorComponent: DefaultError,
  notFoundComponent: DefaultNotFound,
  shellComponent: RootDocument,
});

function RootComponent() {
  const [viewer, setViewer] = useViewerSession();

  useEffect(() => {
    document.documentElement.dataset.appHydrated = "true";
  }, []);

  return (
    <ViewerContext value={viewer}>
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <header className="site-header">
        <Link aria-label="Campus Gaming Network" className="brand" to="/">
          <span aria-hidden="true" className="brand-mark">
            C
          </span>
          <span>Campus Gaming</span>
        </Link>
        <nav aria-label="Main navigation">
          <Link to="/schools">Schools</Link>
          <Link to="/events">Events</Link>
          <Link to="/teams">Teams</Link>
          <AuthNavigation onLoggedOut={() => setViewer(null)} viewer={viewer} />
        </nav>
      </header>
      <MainContent />
      <footer className="site-footer">
        <strong>Campus Gaming Network</strong>
        <Link to="/about">About</Link>
        <Link to="/faq">FAQ</Link>
        <Link to="/support">Support</Link>
        <Link to="/terms">Terms</Link>
        <Link to="/privacy">Privacy</Link>
      </footer>
    </ViewerContext>
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
            const heading =
              document.querySelector<HTMLElement>("#main-content h1");
            heading?.setAttribute("tabindex", "-1");
            heading?.focus();
          });
        });
      }),
    [router],
  );

  return (
    <div id="main-content" tabIndex={-1}>
      <Outlet />
    </div>
  );
}

function useViewerSession(): [ViewerState, (viewer: ViewerState) => void] {
  const router = useRouter();
  // "pending" until /api/navigation-session answers. The server HTML is
  // viewer-neutral, so the slot stays invisible rather than flashing the
  // logged-out links at someone who is signed in. null is a logged-out viewer.
  const [viewer, setViewer] = useState<NavigationViewer | null | "pending">(
    "pending",
  );
  useEffect(() => {
    let controller = new AbortController();

    // Asks again after every resolved navigation, so a login, a rename on the
    // account page, or an expired session shows up in the header. The current
    // answer stays on screen while the request is in flight.
    async function refreshViewer() {
      controller.abort();
      controller = new AbortController();
      const { signal } = controller;

      try {
        const response = await fetch("/api/navigation-session", {
          cache: "no-store",
          signal,
        });
        if (!response.ok) {
          setViewer((current) => (current === "pending" ? null : current));
          return;
        }
        const session: unknown = await response.json();
        const user =
          typeof session === "object" &&
          session !== null &&
          "authenticated" in session &&
          session.authenticated === true &&
          "user" in session
            ? session.user
            : null;
        setViewer(
          typeof user === "object" &&
            user !== null &&
            "id" in user &&
            typeof user.id === "string" &&
            "name" in user &&
            typeof user.name === "string"
            ? { id: user.id, name: user.name }
            : null,
        );
      } catch {
        // Public navigation stays logged out if session discovery is unavailable.
        if (!signal.aborted) {
          setViewer((current) => (current === "pending" ? null : current));
        }
      }
    }

    void refreshViewer();
    const unsubscribe = router.subscribe("onResolved", () => {
      void refreshViewer();
    });
    return () => {
      unsubscribe();
      controller.abort();
    };
  }, [router]);

  return [viewer, setViewer];
}

function AuthNavigation({
  onLoggedOut,
  viewer,
}: {
  onLoggedOut: () => void;
  viewer: ViewerState;
}) {
  const runLogout = useServerFn(logout);
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [logoutError, setLogoutError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setLogoutError("");

    try {
      await runLogout();
      onLoggedOut();
      await router.invalidate();
      await router.navigate({ to: "/", replace: true });
    } catch {
      setLogoutError("We could not log you out. Please try again.");
    } finally {
      setPending(false);
    }
  }

  if (viewer === "pending" || viewer === null) {
    const hidden = viewer === "pending";
    return (
      <>
        <Link className={hidden ? "nav-pending" : undefined} to="/login">
          Log in
        </Link>
        <Link
          className={`button button--primary${hidden ? " nav-pending" : ""}`}
          to="/signup"
        >
          Sign up
        </Link>
      </>
    );
  }

  return (
    <AccountMenu
      logoutError={logoutError}
      logoutPending={pending}
      onLogout={submit}
      viewer={viewer}
    />
  );
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
        <noscript>
          <style>
            {".nav-pending,.viewer-pending{visibility:visible!important}"}
          </style>
        </noscript>
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
