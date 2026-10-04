import { Link, useRouteContext } from "@tanstack/react-router";
import type { ReactNode } from "react";

/**
 * A user's name, linked to their page when the operator may read users. The
 * link rises above a table row's whole-row link.
 */
export function UserLink({
  userId,
  name,
  fallback = "Unknown user",
}: {
  userId: string | undefined;
  name: string | undefined;
  fallback?: string;
}): ReactNode {
  const canRead = useRouteContext({
    strict: false,
    select: (context) =>
      context.admin?.status === "authenticated" &&
      context.admin.session.capabilities.includes("users.read"),
  });
  const label = name ?? fallback;
  if (!userId || !canRead) return label;
  return (
    <Link className="entity-link" params={{ userId }} to="/users/$userId">
      {label}
    </Link>
  );
}
