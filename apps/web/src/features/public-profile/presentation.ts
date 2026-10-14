import type { PageNotice } from "../../components/page-notice.js";
import { pageHead, siteName } from "../../components/public-page-head.js";
import type { PublicProfileDTO } from "./contracts.js";

export const reportUserNotices = {
  failed: {
    message: "We could not submit that report. Please try again.",
    severity: "danger",
  },
  submitted: { message: "Report submitted for review.", severity: "success" },
} as const satisfies Record<string, PageNotice>;

export type ReportUserNotice = keyof typeof reportUserNotices;

/**
 * A profile is open to anyone with its link, but the page head never names the
 * person. The profile does not say whether its owner opted out of people
 * lists, so a preview or search result could expose someone who asked not to
 * be listed. Every profile gets the same generic card and stays out of search.
 */
export function publicProfileHead(loaderData?: {
  profile: { id: string };
  publicOrigin: string;
}) {
  return pageHead(loaderData?.publicOrigin, {
    title: "Player profile",
    description: `A player on ${siteName}. Open the link to see their profile.`,
    path: `/users/${encodeURIComponent(loaderData?.profile.id ?? "")}`,
    noIndex: true,
  });
}

export function verificationLabel(level: string): string {
  const labels: Record<string, string> = {
    basic: "Community member",
    verified: "Verified student",
    staff_faculty: "Staff / faculty",
  };
  return labels[level] ?? "Community member";
}

export function roleIndicatorLabel(role: string): string {
  const labels: Record<string, string> = {
    school_admin: "School admin",
    staff_faculty: "Staff / faculty",
  };
  return labels[role] ?? "Community role";
}

export function publicProfileHomeSchool(profile: PublicProfileDTO): {
  name: string;
  location: string;
  href?: string;
} {
  if (!profile.home_school) {
    return { name: profile.home_school_id, location: "" };
  }

  return {
    name: profile.home_school.name,
    location: [profile.home_school.city, profile.home_school.state]
      .filter(Boolean)
      .join(", "),
    href: `/schools/${profile.home_school.slug}`,
  };
}

export function userInitials(name: string): string {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => Array.from(part)[0]?.toUpperCase() ?? "")
    .join("");
  return initials || "CG";
}

export function safeHTTPURL(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}
