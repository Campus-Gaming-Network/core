import { createFileRoute, redirect } from "@tanstack/react-router";
import {
  firstString,
  legacyResetDestination
} from "../features/auth-flow-slice/contracts";
import { establishPrivateAuthPage } from "../features/auth-flow-slice/auth-flow.functions";
import { authPageHead } from "../features/auth-flow-slice/presentation";

const description =
  "Choose a new password for your Campus Gaming Network account.";

export const Route = createFileRoute("/auth/reset-password")({
  validateSearch: (search: Record<string, unknown>) => {
    const token = firstString(search.token);
    return token ? { token } : {};
  },
  beforeLoad: async ({ search }) => {
    await establishPrivateAuthPage();
    throw redirect({
      href: legacyResetDestination(search.token ?? ""),
      statusCode: 307,
      headers: {
        "cache-control": "private, no-store",
        "referrer-policy": "no-referrer"
      }
    });
  },
  head: () => authPageHead(undefined, {
    title: "Reset password",
    description,
    path: "/auth/reset-password",
    noIndex: true
  }),
  headers: () => ({ "cache-control": "private, no-store" })
});
