import { Link, Outlet, createFileRoute } from "@tanstack/react-router";
import accountCSS from "../features/account-slice/account.css?url";

export const Route = createFileRoute("/settings")({
  head: () => ({ links: [{ rel: "stylesheet", href: accountCSS }] }),
  component: SettingsLayout,
});

function SettingsLayout() {
  return (
    <main className="account-page">
      <p className="eyebrow">Settings</p>
      <nav className="account-nav" aria-label="Settings sections">
        <Link to="/settings/profile">Profile</Link>
      </nav>
      <Outlet />
    </main>
  );
}
