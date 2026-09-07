"use client";

import { Button } from "@heroui/react/button";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { logoutAction } from "../app/actions";

export function AuthNavigation() {
  const pathname = usePathname();
  const router = useRouter();
  const [authenticated, setAuthenticated] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    if (authenticated) {
      return;
    }

    const controller = new AbortController();

    async function refreshAuthentication() {
      try {
        const response = await fetch("/api/navigation-session", {
          cache: "no-store",
          signal: controller.signal
        });
        if (!response.ok) {
          return;
        }

        const session: unknown = await response.json();
        setAuthenticated(
          typeof session === "object" &&
            session !== null &&
            "authenticated" in session &&
            session.authenticated === true
        );
      } catch {
        // Public navigation deliberately stays in its logged-out state when
        // the session endpoint or upstream API is unavailable.
      }
    }

    void refreshAuthentication();

    return () => controller.abort();
  }, [authenticated, pathname]);

  async function handleLogout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoggingOut(true);

    try {
      await logoutAction();
      setAuthenticated(false);
      router.replace("/");
      router.refresh();
    } catch {
      setLoggingOut(false);
    }
  }

  if (authenticated) {
    return (
      <>
        <Link className="link" href="/account">Account</Link>
        <form onSubmit={handleLogout}>
          <Button isDisabled={loggingOut} variant="secondary" type="submit">
            {loggingOut ? "Logging out…" : "Log out"}
          </Button>
        </form>
      </>
    );
  }

  return (
    <>
      <Link className="link" href="/login">Log in</Link>
      <Link className="button button--primary" href="/signup">
        Sign up
      </Link>
    </>
  );
}
