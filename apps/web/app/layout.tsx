import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { AuthNavigation } from "../components/auth-navigation";
import "./globals.css";

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

export default function RootLayout({
	children
}: Readonly<{
	children: ReactNode;
}>) {
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
            <AuthNavigation />
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
