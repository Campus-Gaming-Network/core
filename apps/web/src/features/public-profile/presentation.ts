import type { PublicProfileDTO } from "./contracts.js";

const siteName = "Campus Gaming Network";

export function publicProfileMetadata(
  profile: PublicProfileDTO,
  publicOrigin: string
): { description: string; title: string; url: string } {
  const homeSchool = publicProfileHomeSchool(profile);
  const bio = profile.bio?.trim();

  return {
    title: `${profile.name} | ${siteName}`,
    description:
      bio ||
      (homeSchool.name
        ? `${profile.name} plays at ${homeSchool.name} on ${siteName}.`
        : `${profile.name} on ${siteName}.`),
    url: `${publicOrigin}/users/${encodeURIComponent(profile.id)}`
  };
}

export function verificationLabel(level: string): string {
  const labels: Record<string, string> = {
    basic: "Community member",
    verified: "Verified student",
    staff_faculty: "Staff / faculty"
  };
  return labels[level] ?? "Community member";
}

export function roleIndicatorLabel(role: string): string {
  const labels: Record<string, string> = {
    school_admin: "School admin",
    staff_faculty: "Staff / faculty"
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
    href: `/schools/${profile.home_school.slug}`
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
