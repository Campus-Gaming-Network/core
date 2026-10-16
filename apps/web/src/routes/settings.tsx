import { Outlet, createFileRoute } from "@tanstack/react-router";
import accountCSS from "../features/account-slice/account.css?url";
import { SettingsNav } from "../features/account-slice/settings-nav";

export const Route = createFileRoute("/settings")({
  head: () => ({ links: [{ rel: "stylesheet", href: accountCSS }] }),
  component: SettingsLayout,
});

function SettingsLayout() {
  return (
    <main className="settings-page">
      <div className="settings-layout">
        <SettingsNav />
        <div className="settings-body">
          <Outlet />
        </div>
      </div>
    </main>
  );
}
