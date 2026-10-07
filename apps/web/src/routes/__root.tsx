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
import { getPublicRuntimeConfig } from "../server/public-origin.functions";
import appCSS from "../styles.css?url";
import componentsCSS from "../components.css?url";

const siteName = "Campus Gaming Network";

export const Route = createRootRoute({
  beforeLoad: async () => getPublicRuntimeConfig(),
  loader: ({ context }) => ({
    errorMonitoring: context.errorMonitoring,
    hasSessionCookie: context.hasSessionCookie,
    publicOrigin: context.publicOrigin,
  }),
  // A document rendered for a session names its viewer in the header, so it
  // is private. Everyone else gets the same public document.
  headers: ({ loaderData }) => ({
    "cache-control": loaderData?.hasSessionCookie
      ? "private, no-store"
      : "public, max-age=0, must-revalidate",
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
  const { viewer } = Route.useRouteContext();
  const { errorMonitoring } = Route.useLoaderData();

  useEffect(() => {
    document.documentElement.dataset.appHydrated = "true";
  }, []);

  useEffect(() => {
    if (!errorMonitoring) return;
    void import("../error-monitor").then(({ startBrowserErrorMonitoring }) => {
      startBrowserErrorMonitoring(errorMonitoring);
      document.documentElement.dataset.errorMonitoring = "true";
    });
  }, [errorMonitoring]);

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
          <AuthNavigation viewer={viewer} />
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

function AuthNavigation({ viewer }: { viewer: ViewerState }) {
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
      await router.invalidate();
      await router.navigate({ to: "/", replace: true });
    } catch {
      setLogoutError("We could not log you out. Please try again.");
    } finally {
      setPending(false);
    }
  }

  if (viewer === null) {
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
          {/* The account menu opens with script. Without it, its links and
              logout form sit in the header in place of the trigger. */}
          <style>
            {
              ".account-menu__trigger{display:none!important}.site-header nav .account-menu__panel[hidden]{display:flex!important;position:static;width:auto;min-width:0;flex-wrap:wrap;align-items:center;border:0;padding:0;background:none;box-shadow:none}.site-header nav .account-menu__panel .logout-form{margin:0;padding:0;border:0}"
            }
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
