import { Button } from "@heroui/react/button";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { logoutAction } from "./actions";
import "./globals.css";
import { currentProfile } from "../lib/server-api";

export const metadata: Metadata = {
  title: "Campus Gaming Network",
  description: "Find campus gaming events, teams, and school activity."
};

export default async function RootLayout({
	children
}: Readonly<{
	children: ReactNode;
}>) {
  const profile = await currentProfile();

  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <Link className="brand" href="/">
            Campus Gaming Network
          </Link>
          <nav aria-label="Main navigation">
            <Link className="link" href="/schools">Schools</Link>
            <Link className="link" href="/events">Events</Link>
            <Link className="link" href="/teams">Teams</Link>
            <Link className="link" href="/faq">FAQ</Link>
            {profile ? (
              <>
                <Link className="link" href="/account">Account</Link>
                <form action={logoutAction}>
                  <Button variant="secondary" type="submit">
                    Log out
                  </Button>
                </form>
              </>
            ) : (
              <>
                <Link className="link" href="/login">Log in</Link>
                <Link className="button button--primary" href="/signup">
                  Sign up
                </Link>
              </>
            )}
          </nav>
        </header>
        {children}
        <footer className="site-footer">
          <Link className="link" href="/about">About</Link>
          <Link className="link" href="/support">Support</Link>
          <Link className="link" href="/terms">Terms</Link>
          <Link className="link" href="/privacy">Privacy</Link>
        </footer>
      </body>
    </html>
  );
}
