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

/** Sidebar navigation. `icon` is the path data of a 16px stroked glyph. */
const navigationSections: {
  title?: string;
  items: {
    to:
      | "/"
      | "/reports"
      | "/support-tickets"
      | "/schools"
      | "/games"
      | "/users"
      | "/access/site-admins";
    label: string;
    icon: string;
    capability?: AdminSession["capabilities"][number];
  }[];
}[] = [
  {
    items: [
      {
        to: "/",
        label: "Overview",
        icon: "M2.5 2.5h4.5v4.5H2.5zM9 2.5h4.5v4.5H9zM2.5 9h4.5v4.5H2.5zM9 9h4.5v4.5H9z",
      },
    ],
  },
  {
    title: "Moderation",
    items: [
      {
        to: "/reports",
        label: "Reports",
        icon: "M3.5 14V2.5M3.5 3h8.5l-2 3 2 3H3.5",
        capability: "reports.read",
      },
      {
        to: "/support-tickets",
        label: "Support tickets",
        icon: "M2.5 3.5h11v7.5H7L4 13.5V11H2.5z",
        capability: "support.read",
      },
    ],
  },
  {
    title: "Catalog",
    items: [
      {
        to: "/schools",
        label: "Schools",
        icon: "M1.5 6 8 3l6.5 3L8 9zM4 7.5v3.5c1 1 2.5 1.5 4 1.5s3-.5 4-1.5V7.5",
        capability: "schools.read",
      },
      {
        to: "/games",
        label: "Games",
        icon: "M4.5 5h7a3 3 0 0 1 0 6c-1 0-1.5-1-2.5-1H7c-1 0-1.5 1-2.5 1a3 3 0 0 1 0-6zM5 7.25v1.5M4.25 8h1.5M11 8h.01",
        capability: "games.manage",
      },
    ],
  },
  {
    title: "Access",
    items: [
      {
        to: "/users",
        label: "Users",
        icon: "M8 7.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM3 13.5c0-2.5 2.2-4 5-4s5 1.5 5 4",
        capability: "users.read",
      },
      {
        to: "/access/site-admins",
        label: "Site admins",
        icon: "M8 2 3 4v3.5c0 3 2 5.3 5 6.5 3-1.2 5-3.5 5-6.5V4zM6 8l1.5 1.5L10 6.5",
        capability: "site_grants.manage",
      },
    ],
  },
];

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
        <div className="sidebar-header">
          <Link className="brand" to="/" aria-label="CGN Admin Console home">
            <span className="brand-mark" aria-hidden="true">
              CGN
            </span>
            <span className="brand-text">
              <strong>Admin Console</strong>
              <span>Campus Gaming Network</span>
            </span>
          </Link>
          <p
            className={`queue-status environment-badge${environment === "production" ? "" : " queue-status--in_review"}`}
          >
            {environmentLabels[environment]}
          </p>
        </div>
        <nav aria-label="Admin navigation">
          {navigationSections.map((section) => {
            const items = section.items.filter(
              (item) => !item.capability || can(item.capability),
            );
            if (!items.length) return null;
            return (
              <div className="sidebar-section" key={section.title ?? "home"}>
                {section.title ? (
                  <span className="sidebar-section__title">
                    {section.title}
                  </span>
                ) : null}
                <ul>
                  {items.map((item) => (
                    <li key={item.to}>
                      <Link
                        to={item.to}
                        activeOptions={{ exact: item.to === "/" }}
                      >
                        <svg
                          aria-hidden="true"
                          fill="none"
                          stroke="currentColor"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="1.5"
                          viewBox="0 0 16 16"
                        >
                          <path d={item.icon} />
                        </svg>
                        {item.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </nav>
        <div className="operator-card">
          <div className="operator-card__identity">
            <strong title={session.email}>{session.email}</strong>
            <span>
              Session ends{" "}
              <time dateTime={session.absolute_expires_at}>
                {formatTimestamp(session.absolute_expires_at)} UTC
              </time>
            </span>
          </div>
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
      className="text-button theme-toggle"
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
