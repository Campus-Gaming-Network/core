import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Campus Gaming Network",
  description: "Find campus gaming events, teams, and school activity."
};

export default function RootLayout({
	children
}: Readonly<{
	children: ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
