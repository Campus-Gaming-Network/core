import {
  HeadContent,
  Link,
  Outlet,
  Scripts,
  createRootRoute,
  useRouter,
} from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent, type ReactNode } from "react";
import {
  DefaultError,
  DefaultNotFound,
  DefaultPending,
} from "../components/route-boundaries";
import { formatTimestamp } from "../features/moderation/moderation-components";
import { getAdminShellSession, logout } from "../features/session.functions";
import { initialColorTheme, toggleColorTheme } from "../features/theme";
import type { AdminSession } from "../server/contracts.server";
import appCSS from "../styles.css?url";

export const Route = createRootRoute({
  beforeLoad: async () => ({ admin: await getAdminShellSession() }),
  headers: () => ({
    "cache-control": "private, no-store",
    vary: "Cookie",
  }),
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "application-name", content: "CGN Admin Console" },
      { name: "robots", content: "noindex,nofollow,noarchive,nosnippet" },
      { name: "referrer", content: "no-referrer" },
    ],
    links: [{ rel: "stylesheet", href: appCSS }],
  }),
  component: RootComponent,
  pendingComponent: DefaultPending,
  errorComponent: DefaultError,
  notFoundComponent: DefaultNotFound,
  shellComponent: RootDocument,
});

function RootComponent() {
  const { admin } = Route.useRouteContext();
  if (admin.status === "unauthorized") {
    return (
      <AccessState
        eyebrow="Access required"
        heading="Sign in through Cloudflare Access."
        message="A current Access identity and an active CGN site-admin grant are required."
      />
    );
  }
  if (admin.status === "forbidden") {
    return (
      <AccessState
        eyebrow="Site admin required"
        heading="This account cannot open the Admin Console."
        message="Ask an authorized operator to review your site-admin grant."
      />
    );
  }
  if (admin.status === "unavailable") {
    return (
      <AccessState
        eyebrow="Temporarily unavailable"
        heading="We could not verify administrative access."
        message="No protected content was loaded. Try again after the control plane recovers."
      />
    );
  }

  return (
    <AuthenticatedShell
      environment={admin.environment}
      session={admin.session}
    />
  );
}

const environmentLabels = {
  local: "Local",
  staging: "Staging",
  production: "Production",
} as const;

function AuthenticatedShell({
  environment,
  session,
}: {
  environment: keyof typeof environmentLabels;
  session: AdminSession;
}) {
  const can = (capability: AdminSession["capabilities"][number]) =>
    session.capabilities.includes(capability);
  return (
    <div
      className={`app-shell${environment === "production" ? "" : " app-shell--non-production"}`}
    >
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <aside className="sidebar">
        <Link className="brand" to="/" aria-label="CGN Admin Console home">
          <span className="brand-mark" aria-hidden="true">
            CGN
          </span>
          <span>Admin Console</span>
        </Link>
        <p
          className={`queue-status environment-badge${environment === "production" ? "" : " queue-status--in_review"}`}
        >
          {environmentLabels[environment]}
        </p>
        <nav aria-label="Admin navigation">
          <Link to="/" activeOptions={{ exact: true }}>
            Overview
          </Link>
          {can("reports.read") ? <Link to="/reports">Reports</Link> : null}
          {can("support.read") ? (
            <Link to="/support-tickets">Support tickets</Link>
          ) : null}
          {can("schools.read") ? <Link to="/schools">Schools</Link> : null}
          {can("games.manage") ? <Link to="/games">Games</Link> : null}
          {can("users.read") ? <Link to="/users">Users</Link> : null}
          {can("site_grants.manage") ? (
            <Link to="/access/site-admins">Site admins</Link>
          ) : null}
        </nav>
        <div className="operator-card">
          <span>Signed in as</span>
          <strong title={session.email}>{session.email}</strong>
          <span>
            Session ends{" "}
            <time dateTime={session.absolute_expires_at}>
              {formatTimestamp(session.absolute_expires_at)} UTC
            </time>
          </span>
          <div className="operator-actions">
            <ThemeToggle />
            <LogoutForm />
          </div>
        </div>
      </aside>
      <main id="main-content" className="main-content" tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  );
}

function LogoutForm() {
  const runLogout = useServerFn(logout);
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    try {
      await runLogout();
      await router.invalidate();
      await router.navigate({ to: "/", replace: true });
    } finally {
      setPending(false);
    }
  }

  return (
    <form action={logout.url} method="post" onSubmit={submit}>
      <button className="text-button" type="submit" disabled={pending}>
        {pending ? "Signing out…" : "Sign out"}
      </button>
    </form>
  );
}

function ThemeToggle() {
  return (
    <button
      aria-label="Switch between light and dark mode"
      className="theme-toggle"
      type="button"
      onClick={toggleColorTheme}
    >
      <span className="theme-toggle__light">Light mode</span>
      <span className="theme-toggle__dark">Dark mode</span>
    </button>
  );
}

function AccessState({
  eyebrow,
  heading,
  message,
}: {
  eyebrow: string;
  heading: string;
  message: string;
}) {
  return (
    <main className="state-page">
      <ThemeToggle />
      <p className="eyebrow">{eyebrow}</p>
      <h1>{heading}</h1>
      <p>{message}</p>
    </main>
  );
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" data-theme={initialColorTheme()}>
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
