import type { SchoolDTO } from "./contracts.js";

export const siteName = "Campus Gaming Network";
export const homeDescription =
  "Discover collegiate gaming events, teams, and campus activity. Follow your school and find the scene around you.";
export const schoolsDescription =
  "Search and follow colleges and universities to see their gaming events and teams.";

export function schoolLocation(
  school: Pick<SchoolDTO, "city" | "state">,
  fallback = "Location pending"
): string {
  return [school.city, school.state].filter(Boolean).join(", ") || fallback;
}

export function safeSchoolWebsite(value: string | undefined): string | undefined {
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

export function homeHead(publicOrigin = "http://localhost:3100") {
  return pageHead({
    bareTitle: true,
    title: siteName,
    description: homeDescription,
    url: publicOrigin
  });
}

export function schoolsHead(publicOrigin = "http://localhost:3100") {
  return pageHead({
    title: "Schools",
    description: schoolsDescription,
    url: `${publicOrigin}/schools`
  });
}

export function schoolHead(
  school: SchoolDTO | undefined,
  publicOrigin = "http://localhost:3100"
) {
  if (!school) {
    return {
      meta: [
        { title: `School | ${siteName}` },
        { name: "description", content: "School details are unavailable." },
        { name: "robots", content: "noindex,nofollow" }
      ]
    };
  }

  const location = schoolLocation(school);
  const description =
    `Campus gaming events, teams, and activity at ${school.name} in ${location}.`;

  return pageHead({
    title: school.name,
    description,
    url: `${publicOrigin}/schools/${encodeURIComponent(school.slug)}`
  });
}

function pageHead({
  bareTitle = false,
  title,
  description,
  url
}: {
  bareTitle?: boolean;
  title: string;
  description: string;
  url: string;
}) {
  const fullTitle = bareTitle ? title : `${title} | ${siteName}`;
  return {
    meta: [
      { title: fullTitle },
      { name: "description", content: description },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: siteName },
      { property: "og:title", content: fullTitle },
      { property: "og:description", content: description },
      { property: "og:url", content: url },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: fullTitle },
      { name: "twitter:description", content: description }
    ]
  };
}
