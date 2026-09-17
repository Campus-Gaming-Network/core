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
import { getAdminShellSession, logout } from "../features/session.functions";
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

  return <AuthenticatedShell email={admin.session.email} />;
}

function AuthenticatedShell({ email }: { email: string }) {
  return (
    <div className="app-shell">
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
        <nav aria-label="Admin navigation">
          <Link to="/" activeOptions={{ exact: true }}>
            Overview
          </Link>
        </nav>
        <div className="operator-card">
          <span>Signed in as</span>
          <strong>{email}</strong>
          <LogoutForm />
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
      <p className="eyebrow">{eyebrow}</p>
      <h1>{heading}</h1>
      <p>{message}</p>
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
