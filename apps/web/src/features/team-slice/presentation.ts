import type { PageNotice } from "../../components/page-notice.js";
import {
  absoluteUrl,
  pageHead,
  previewText,
  siteName,
} from "../../components/public-page-head.js";
import type { TeamDTO, TeamRole } from "./contracts.js";

// Native team forms redirect failures to the team page, or to the browse page
// when the submitted slug was unusable.
export const teamBrowseNotices = {
  "join-failed": {
    message: "We could not join that team. Please try again.",
    severity: "danger",
  },
  "manage-failed": {
    message: "We could not update team management. Please try again.",
    severity: "danger",
  },
} as const satisfies Record<string, PageNotice>;

export const teamDetailNotices = {
  ...teamBrowseNotices,
  "captain-updated": { message: "Captain role updated.", severity: "success" },
  created: { message: "Team created.", severity: "success" },
  joined: { message: "You joined the team.", severity: "success" },
  "ownership-transferred": {
    message: "Ownership transferred.",
    severity: "success",
  },
} as const satisfies Record<string, PageNotice>;

export type TeamBrowseNotice = keyof typeof teamBrowseNotices;
export type TeamDetailNotice = keyof typeof teamDetailNotices;

const teamsDescription =
  "Browse collegiate gaming teams and find one to join on your campus.";
const newTeamDescription = "Start a new collegiate gaming team.";

export function teamRoleLabel(role: TeamRole): string {
  const labels: Record<TeamRole, string> = {
    owner: "Owner",
    captain: "Captain",
    member: "Member",
  };
  return labels[role];
}

export function teamsHead(publicOrigin?: string) {
  return pageHead(publicOrigin, {
    title: "Teams",
    description: teamsDescription,
    path: "/teams",
  });
}

export function teamHead(team: TeamDTO | undefined, publicOrigin?: string) {
  if (!team) {
    return {
      meta: [
        { title: `Team | ${siteName}` },
        { name: "description", content: "Team details are unavailable." },
        { name: "robots", content: "noindex,nofollow" },
      ],
      links: [],
    };
  }

  const description = previewText(
    team.description.trim() ||
      `A collegiate gaming team at ${team.school?.name ?? siteName}.`,
  );
  const path = `/teams/${encodeURIComponent(team.slug)}` as const;
  // The roster is never part of the head: a team page names its school only.
  return pageHead(publicOrigin, {
    title: team.name,
    description,
    path,
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "SportsTeam",
      name: team.name,
      url: absoluteUrl(publicOrigin, path),
      description,
      sport: "Esports",
      ...(team.school
        ? {
            parentOrganization: {
              "@type": "CollegeOrUniversity",
              name: team.school.name,
              url: absoluteUrl(
                publicOrigin,
                `/schools/${encodeURIComponent(team.school.slug)}`,
              ),
            },
          }
        : {}),
    },
  });
}

export function newTeamHead(publicOrigin?: string) {
  return pageHead(publicOrigin, {
    title: "Start a team",
    description: newTeamDescription,
    path: "/teams/new",
    noIndex: true,
  });
}
