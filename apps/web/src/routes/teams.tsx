import { Outlet, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/teams")({ component: TeamsLayout });

function TeamsLayout() {
  return <Outlet />;
}
