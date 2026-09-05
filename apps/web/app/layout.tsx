import { Button } from "@heroui/react/button";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { logoutAction } from "./actions";
import "./globals.css";
import { Icon, appIcon } from "../components/icon";
import { currentProfile } from "../lib/server-api";

const siteName = "Campus Gaming Network";
const siteDescription =
  "Find campus gaming events, teams, and school activity.";
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: siteName,
    template: `%s | ${siteName}`
  },
  description: siteDescription,
  applicationName: siteName,
  openGraph: {
    type: "website",
    siteName,
    title: siteName,
    description: siteDescription,
    url: siteUrl
  },
  twitter: {
    card: "summary",
    title: siteName,
    description: siteDescription
  }
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
            <Icon icon={appIcon.game} size="lg" />
            Campus Gaming Network
          </Link>
          <nav aria-label="Main navigation">
            <Link className="link icon-text" href="/schools">
              <Icon icon={appIcon.school} />
              Schools
            </Link>
            <Link className="link icon-text" href="/events">
              <Icon icon={appIcon.event} />
              Events
            </Link>
            <Link className="link icon-text" href="/teams">
              <Icon icon={appIcon.team} />
              Teams
            </Link>
            <Link className="link icon-text" href="/faq">
              <Icon icon={appIcon.faq} />
              FAQ
            </Link>
            {profile ? (
              <>
                <Link className="link icon-text" href="/account">
                  <Icon icon={appIcon.account} />
                  Account
                </Link>
                <form action={logoutAction}>
                  <Button variant="secondary" type="submit">
                    <Icon icon={appIcon.logOut} />
                    Log out
                  </Button>
                </form>
              </>
            ) : (
              <>
                <Link className="link icon-text" href="/login">
                  <Icon icon={appIcon.logIn} />
                  Log in
                </Link>
                <Link className="button button--primary" href="/signup">
                  <Icon icon={appIcon.signUp} />
                  Sign up
                </Link>
              </>
            )}
          </nav>
        </header>
        {children}
        <footer className="site-footer">
          <Link className="link icon-text" href="/about">
            <Icon icon={appIcon.about} size="sm" />
            About
          </Link>
          <Link className="link icon-text" href="/support">
            <Icon icon={appIcon.support} size="sm" />
            Support
          </Link>
          <Link className="link icon-text" href="/terms">
            <Icon icon={appIcon.terms} size="sm" />
            Terms
          </Link>
          <Link className="link icon-text" href="/privacy">
            <Icon icon={appIcon.privacy} size="sm" />
            Privacy
          </Link>
        </footer>
      </body>
    </html>
  );
}
