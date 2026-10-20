import type { PageNotice } from "../../components/page-notice.js";
import {
  absoluteUrl,
  pageHead,
  siteName,
} from "../../components/public-page-head.js";
import { previewImageUrl } from "../seo-slice/preview.js";
import type { SchoolDTO, SchoolStatsDTO } from "./contracts.js";

export { siteName };

// Native follow forms redirect failures to the school page, or to the browse
// page when the submitted slug was unusable.
export const schoolBrowseNotices = {
  failed: {
    message: "We could not update this school follow. Please try again.",
    severity: "danger",
  },
} as const satisfies Record<string, PageNotice>;

export const schoolDetailNotices = {
  ...schoolBrowseNotices,
  added: { message: "School followed.", severity: "success" },
  removed: { message: "School unfollowed.", severity: "success" },
} as const satisfies Record<string, PageNotice>;

export type SchoolBrowseNotice = keyof typeof schoolBrowseNotices;
export type SchoolDetailNotice = keyof typeof schoolDetailNotices;

const homeDescription =
  "Discover collegiate gaming events, teams, and campus activity. Follow your school and find the scene around you.";
const schoolsDescription =
  "Search and follow colleges and universities to see their gaming events and teams.";

export function schoolLocation(
  school: Pick<SchoolDTO, "city" | "state">,
  fallback = "Location pending",
): string {
  return [school.city, school.state].filter(Boolean).join(", ") || fallback;
}

/** Which of a school's counts a phrase is, so a list can give it an icon. */
export type SchoolActivityKind = "teams" | "upcoming_events" | "members";

/**
 * A school's CGN activity as short phrases, such as "3 teams". Only counts
 * above zero are listed, so a school with nothing yet lists nothing rather
 * than a row of zeros; a count is never rounded up.
 */
export function schoolActivityCounts(
  stats: SchoolStatsDTO,
): { kind: SchoolActivityKind; label: string }[] {
  return [
    {
      kind: "teams" as const,
      label: counted(stats.teams, "team", "teams"),
      count: stats.teams,
    },
    {
      kind: "upcoming_events" as const,
      label: counted(
        stats.upcoming_events,
        "upcoming event",
        "upcoming events",
      ),
      count: stats.upcoming_events,
    },
    {
      kind: "members" as const,
      label: counted(stats.members, "member", "members"),
      count: stats.members,
    },
  ]
    .filter(({ count }) => count > 0)
    .map(({ kind, label }) => ({ kind, label }));
}

function counted(count: number, one: string, many: string): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;
}

/**
 * The short name to show beside a school's name: the one an admin chose, or a
 * guess from the alias. The catalog's alias is a search field that can list
 * former names, variants, and misspellings, so the guess is its first acronym,
 * or the alias itself when it is one short name; otherwise nothing.
 */
export function schoolShortName(
  school: Pick<SchoolDTO, "name" | "alias" | "short_name">,
): string | undefined {
  if (school.short_name) return school.short_name;
  const names = (school.alias ?? "")
    .split(/[|,;]/)
    .map((name) => name.trim())
    .filter(Boolean);
  const acronym = names.find((name) => /^[A-Z&-]{2,8}$/.test(name));
  if (acronym) return acronym;
  const [only] = names;
  return names.length === 1 && only.length <= 20 && only !== school.name
    ? only
    : undefined;
}

export function safeSchoolWebsite(
  value: string | undefined,
): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

export function homeHead(publicOrigin?: string) {
  return pageHead(publicOrigin, {
    bareTitle: true,
    title: siteName,
    description: homeDescription,
    path: "",
  });
}

export function schoolsHead(publicOrigin?: string) {
  return pageHead(publicOrigin, {
    title: "Schools",
    description: schoolsDescription,
    path: "/schools",
  });
}

export function schoolHead(
  school: SchoolDTO | undefined,
  publicOrigin?: string,
) {
  if (!school) {
    return {
      meta: [
        { title: `School | ${siteName}` },
        { name: "description", content: "School details are unavailable." },
        { name: "robots", content: "noindex,nofollow" },
      ],
      links: [],
    };
  }

  const location = schoolLocation(school);
  const description = `Campus gaming events, teams, and activity at ${school.name} in ${location}.`;
  const path = `/schools/${encodeURIComponent(school.slug)}` as const;
  const logo = previewImageUrl(publicOrigin, school.logo_url);
  const website = safeSchoolWebsite(school.website_url);

  return pageHead(publicOrigin, {
    title: school.name,
    description,
    path,
    breadcrumbs: [{ name: "Schools", path: "/schools" }],
    ...(logo ? { image: logo, imageAlt: `${school.name} logo` } : {}),
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "CollegeOrUniversity",
      name: school.name,
      url: absoluteUrl(publicOrigin, path),
      ...(website ? { sameAs: [website] } : {}),
      ...(logo ? { logo } : {}),
      ...(school.city || school.state
        ? {
            address: {
              "@type": "PostalAddress",
              ...(school.city ? { addressLocality: school.city } : {}),
              ...(school.state ? { addressRegion: school.state } : {}),
              addressCountry: "US",
            },
          }
        : {}),
    },
  });
}
