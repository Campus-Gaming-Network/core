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
            <Link href="/schools">Schools</Link>
            <Link href="/events">Events</Link>
            <Link href="/faq">FAQ</Link>
            {profile ? (
              <>
                <Link href="/account">Account</Link>
                <form action={logoutAction}>
                  <button type="submit">Log out</button>
                </form>
              </>
            ) : (
              <>
                <Link href="/login">Log in</Link>
                <Link className="nav-cta" href="/signup">
                  Sign up
                </Link>
              </>
            )}
          </nav>
        </header>
        {children}
        <footer className="site-footer">
          <Link href="/about">About</Link>
          <Link href="/support">Support</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/privacy">Privacy</Link>
        </footer>
      </body>
    </html>
  );
}
