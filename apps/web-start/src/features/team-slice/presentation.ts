import type { TeamDTO, TeamRole } from "./contracts.js";

const siteName = "Campus Gaming Network";
export const teamsDescription =
  "Browse collegiate gaming teams and find one to join on your campus.";
export const newTeamDescription = "Start a new collegiate gaming team.";

export function teamRoleLabel(role: TeamRole): string {
  const labels: Record<TeamRole, string> = {
    owner: "Owner",
    captain: "Captain",
    member: "Member"
  };
  return labels[role];
}

export function teamsHead(publicOrigin = "http://localhost:3100") {
  return pageHead({
    title: "Teams",
    description: teamsDescription,
    url: `${publicOrigin}/teams`
  });
}

export function teamHead(
  team: TeamDTO | undefined,
  publicOrigin = "http://localhost:3100"
) {
  if (!team) {
    return {
      meta: [
        { title: `Team | ${siteName}` },
        { name: "description", content: "Team details are unavailable." },
        { name: "robots", content: "noindex,nofollow" }
      ]
    };
  }

  const description =
    team.description.trim() ||
    `A collegiate gaming team at ${team.school?.name ?? siteName}.`;
  return pageHead({
    title: team.name,
    description,
    url: `${publicOrigin}/teams/${encodeURIComponent(team.slug)}`
  });
}

export function newTeamHead(publicOrigin = "http://localhost:3100") {
  const title = `Start a team | ${siteName}`;
  return {
    meta: [
      { title },
      { name: "description", content: newTeamDescription },
      { name: "robots", content: "noindex,nofollow" },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: siteName },
      { property: "og:title", content: title },
      { property: "og:description", content: newTeamDescription },
      { property: "og:url", content: `${publicOrigin}/teams/new` },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: title },
      { name: "twitter:description", content: newTeamDescription }
    ]
  };
}

function pageHead({
  title,
  description,
  url
}: {
  title: string;
  description: string;
  url: string;
}) {
  const fullTitle = `${title} | ${siteName}`;
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
