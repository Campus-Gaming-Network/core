import {
  roleIndicatorLabel,
  verificationLabel,
} from "../event-slice/presentation.js";
import { teamRoleLabel } from "../team-slice/presentation.js";
import type { PersonDTO } from "./contracts.js";

const siteName = "Campus Gaming Network";

/**
 * The line under a person's name: their verification and any role indicators,
 * the way organizers are shown.
 */
export function verificationDetail({
  role_indicators = [],
  verification_level,
}: Pick<PersonDTO, "role_indicators" | "verification_level">): string {
  return [
    verificationLabel(verification_level),
    ...role_indicators
      .filter((role) => role !== verification_level)
      .map(roleIndicatorLabel),
  ].join(" · ");
}

/** The line under a person in a list: their team role, else their verification. */
export function personDetail(person: PersonDTO): string {
  return person.role ? teamRoleLabel(person.role) : verificationDetail(person);
}

/**
 * Head for a people page. These pages are for signed-in viewers, so they are
 * kept out of search results.
 */
export function peopleHead({
  description,
  path,
  publicOrigin = "http://localhost:3000",
  title,
}: {
  description: string;
  path: string;
  publicOrigin?: string;
  title: string;
}) {
  const fullTitle = `${title} | ${siteName}`;

  return {
    meta: [
      { title: fullTitle },
      { name: "description", content: description },
      { name: "robots", content: "noindex,nofollow" },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: siteName },
      { property: "og:title", content: fullTitle },
      { property: "og:description", content: description },
      { property: "og:url", content: `${publicOrigin}${path}` },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: fullTitle },
      { name: "twitter:description", content: description },
    ],
  };
}

/** Head for a people page whose loader did not finish. */
export function unavailablePeopleHead() {
  return {
    meta: [
      { title: `People | ${siteName}` },
      { name: "robots", content: "noindex,nofollow" },
    ],
  };
}
