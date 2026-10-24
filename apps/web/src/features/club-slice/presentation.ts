import {
  absoluteUrl,
  pageHead,
  previewText,
  siteName,
} from "../../components/public-page-head.js";
import { firstGameCoverUrl } from "../seo-slice/preview.js";
import type { ClubDTO, ClubType } from "./contracts.js";

export const clubTypeLabels: Record<ClubType, string> = {
  student_club: "Student club",
  university_program: "University program",
};

/**
 * Who stands behind the page: CGN until the club is claimed, then the club.
 */
export function clubManagedBy(club: Pick<ClubDTO, "claimed">): string {
  return club.claimed
    ? "Managed by the club"
    : "Maintained by Campus Gaming Network";
}

/**
 * When the details were last confirmed and by whom, or nothing when they
 * never were. The date reads in UTC so every viewer sees the same day.
 */
export function clubConfirmedLine(
  club: Pick<ClubDTO, "confirmed_at" | "confirmed_source">,
): string | undefined {
  if (!club.confirmed_at || !club.confirmed_source) return undefined;
  const date = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(club.confirmed_at));
  return club.confirmed_source === "club"
    ? `Confirmed by the club on ${date}`
    : `Checked by Campus Gaming Network on ${date}`;
}

/**
 * The tag a club wears once its last confirmation is out of date. It says
 * only that, never that the club is inactive.
 */
export const clubNeedsConfirmationLabel = "Needs confirmation";

export function clubsHead(publicOrigin?: string) {
  return pageHead(publicOrigin, {
    title: "Clubs",
    description:
      "Gaming clubs and esports programs at colleges across the United States, and how to join them.",
    path: "/clubs",
  });
}

export function clubHead(club: ClubDTO | undefined, publicOrigin?: string) {
  if (!club) {
    return {
      meta: [
        { title: `Club | ${siteName}` },
        { name: "description", content: "Club details are unavailable." },
        { name: "robots", content: "noindex,nofollow" },
      ],
      links: [],
    };
  }
  const description = previewText(
    club.summary.trim() ||
      `A ${clubTypeLabels[club.type].toLowerCase()} at ${club.school.name}.`,
  );
  const path = `/clubs/${encodeURIComponent(club.slug)}` as const;
  const cover = firstGameCoverUrl(publicOrigin, club.games);
  return pageHead(publicOrigin, {
    title: `${club.name} · ${club.school.name}`,
    description,
    path,
    breadcrumbs: [
      {
        name: club.school.name,
        path: `/schools/${encodeURIComponent(club.school.slug)}`,
      },
    ],
    ...(cover
      ? {
          image: cover,
          imageAlt: `${club.games.find((g) => g.has_cover)?.name} cover art`,
        }
      : {}),
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: club.name,
      url: absoluteUrl(publicOrigin, path),
      description,
      ...(cover ? { image: cover } : {}),
      parentOrganization: {
        "@type": "CollegeOrUniversity",
        name: club.school.name,
        url: absoluteUrl(
          publicOrigin,
          `/schools/${encodeURIComponent(club.school.slug)}`,
        ),
      },
    },
  });
}
