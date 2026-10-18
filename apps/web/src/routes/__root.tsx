import {
  HeadContent,
  Link,
  Outlet,
  Scripts,
  useRouter,
  createRootRoute,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Bell, Gamepad2 } from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { AccountMenu } from "../components/account-menu";
import { RouteAnnouncer } from "../components/route-announcer";
import { SiteNavigation } from "../components/site-navigation";
import { ViewerContext, type ViewerState } from "../components/viewer";
import {
  DefaultError,
  DefaultNotFound,
  DefaultPending,
} from "../components/route-boundaries";
import { logout } from "../features/event-slice/auth.functions";
import { getPublicRuntimeConfig } from "../server/public-origin.functions";
import { sessionEndedEvent } from "../session-ended";
import appCSS from "../styles.css?url";
import componentsCSS from "../components.css?url";

const siteName = "Campus Gaming Network";

export const Route = createRootRoute({
  beforeLoad: async () => getPublicRuntimeConfig(),
  loader: ({ context }) => ({
    errorMonitoring: context.errorMonitoring,
    hasSessionCookie: context.hasSessionCookie,
    publicOrigin: context.publicOrigin,
    // The moment this page was rendered. The browser hydrates with the same
    // value, so clock-dependent labels (an event's "Today") match the server
    // HTML instead of appearing late.
    renderedAt: Date.now(),
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
      // The navy of the site header, so a phone's browser chrome matches it.
      { name: "theme-color", content: "#0b1622" },
    ],
    links: [
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
      {
        rel: "icon",
        href: "/favicon-32.png",
        type: "image/png",
        sizes: "32x32",
      },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      { rel: "manifest", href: "/site.webmanifest" },
      { rel: "stylesheet", href: appCSS },
      { rel: "stylesheet", href: componentsCSS },
    ],
  }),
  component: RootComponent,
  pendingComponent: DefaultPending,
  errorComponent: RootError,
  notFoundComponent: DefaultNotFound,
  shellComponent: RootDocument,
});

function RootComponent() {
  const { viewer } = Route.useRouteContext();
  const { errorMonitoring } = Route.useLoaderData();
  const router = useRouter();

  useEffect(() => {
    document.documentElement.dataset.appHydrated = "true";
  }, []);

  // The server ended the session during a request from this page. Reloading
  // the routes shows the signed-out header, and a page that needs an account
  // sends the visitor to log in.
  useEffect(() => {
    const showSignedOut = () => void router.invalidate();
    window.addEventListener(sessionEndedEvent, showSignedOut);
    return () => window.removeEventListener(sessionEndedEvent, showSignedOut);
  }, [router]);

  useEffect(() => {
    if (!errorMonitoring) return;
    void import("../error-monitor").then(({ startBrowserErrorMonitoring }) => {
      startBrowserErrorMonitoring(errorMonitoring);
      document.documentElement.dataset.errorMonitoring = "true";
    });
  }, [errorMonitoring]);

  return (
    <ViewerContext value={viewer}>
      <SiteShell account={<AuthNavigation viewer={viewer} />}>
        <MainContent />
      </SiteShell>
    </ViewerContext>
  );
}

/**
 * The header, the main content area, and the footer around every page. The
 * root's error view uses it too, so a failure at the root keeps the site's
 * navigation; there the viewer is unknown, so `account` is left out.
 */
function SiteShell({
  account,
  children,
}: {
  account?: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <header className="site-header">
        <Link aria-label="Campus Gaming Network" className="brand" to="/">
          <span aria-hidden="true" className="brand-mark">
            <Gamepad2 size={18} strokeWidth={2.25} />
          </span>
          <span className="brand-name">CGN</span>
          <span className="brand-full">Campus Gaming Network</span>
        </Link>
        <nav aria-label="Main navigation">
          <SiteNavigation />
          {account}
        </nav>
      </header>
      <div id="main-content" tabIndex={-1}>
        {children}
      </div>
      <footer className="site-footer">
        <div className="site-footer__inner">
          <span className="site-footer__brand">
            <span aria-hidden="true" className="brand-mark">
              <Gamepad2 size={16} strokeWidth={2.25} />
            </span>
            Campus Gaming Network
          </span>
          <nav aria-label="Footer">
            <ul>
              <li>
                <Link to="/about">About</Link>
              </li>
              <li>
                <Link to="/faq">FAQ</Link>
              </li>
              <li>
                <Link to="/support">Support</Link>
              </li>
              <li>
                <Link to="/terms">Terms</Link>
              </li>
              <li>
                <Link to="/privacy">Privacy</Link>
              </li>
            </ul>
          </nav>
        </div>
      </footer>
    </>
  );
}

/** The root's error view inside the site shell. */
function RootError(props: ErrorComponentProps) {
  return (
    <SiteShell>
      <DefaultError {...props} />
    </SiteShell>
  );
}

function MainContent() {
  return (
    <>
      <RouteAnnouncer />
      <Outlet />
    </>
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
      <div className="auth-links">
        <Link to="/login">Log in</Link>
        <Link className="button button--primary" to="/signup">
          Sign up
        </Link>
      </div>
    );
  }

  const unread = viewer.unreadNotifications ?? 0;
  return (
    <div className="auth-links">
      <Link
        aria-label={
          unread > 0 ? `Notifications, ${unread} unread` : "Notifications"
        }
        className="notifications-link"
        to="/notifications"
      >
        <Bell aria-hidden="true" size={20} strokeWidth={2} />
        {unread > 0 ? (
          <span aria-hidden="true" className="notifications-link__count">
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </Link>
      <AccountMenu
        logoutError={logoutError}
        logoutPending={pending}
        onLogout={submit}
        viewer={viewer}
      />
    </div>
  );
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
        <noscript>
          {/* The account and site menus open with script. Without it, the
              account links and logout form sit in the header in place of the
              trigger, and the site links always show. Controls that need
              script (live-only) hide, and a filter toolbar's Apply button
              shows, so a page never swaps controls while it hydrates. */}
          <style>
            {
              ".live-only{display:none!important}.filter-toolbar__apply{display:inline-flex!important}.site-nav__toggle{display:none!important}.site-nav__links{display:flex!important;position:static!important;flex-direction:row!important}@media(max-width:42rem){.site-header{flex-wrap:wrap!important}.site-header nav{flex-wrap:wrap!important}.site-nav{order:3!important;flex:0 0 100%}.site-nav__links{flex-wrap:wrap!important;border:0!important;box-shadow:none!important;padding:0!important}.site-header nav .site-nav__links a{min-height:2.75rem!important;padding:0 .625rem!important}}.account-menu__trigger{display:none!important}.site-header nav .account-menu__panel[hidden]{display:flex!important;position:static;width:auto;min-width:0;flex-wrap:wrap;align-items:center;border:0;padding:0;background:none;box-shadow:none}.site-header nav .account-menu__panel .account-menu__item{color:#fff!important;width:auto!important}.site-header nav .account-menu__panel .logout-form{margin:0;padding:0;border:0}"
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
