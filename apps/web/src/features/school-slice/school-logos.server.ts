import manifest from "../../../public/school-logos/manifest.json" with { type: "json" };
import { bundledSchoolLogoBase } from "../../server/environment.server.js";
import type { SchoolDTO, WithSchoolLogo } from "./contracts.js";

// An athletics mark, where one exists, replaces the institutional logo: it
// stays legible in the small square the directory gives it.
const bundledLogos = new Map(
  [
    ...manifest.logos.map((logo) => ({ ...logo, athletics: false })),
    ...manifest.athletics.map((logo) => ({ ...logo, athletics: true })),
  ].map((logo) => [logo.unitid, logo]),
);

// Too wide to read in a small square. An institutional logo past 3:2 is a
// line of text; an athletics mark is usually a picture and reads up to 2:1.
function unreadableSmall(logo: {
  width: number;
  height: number;
  athletics: boolean;
}): boolean {
  return logo.width / logo.height > (logo.athletics ? 2 : 1.5);
}

const bundledLogosBySlug = new Map(
  [...bundledLogos.values()].map((logo) => [logo.slug, logo]),
);

/** Seed identity only: never guess by name or inherit a main-campus logo. */
export function bundledSchoolLogo(
  school: Pick<SchoolDTO, "unitid" | "slug">,
):
  | Pick<
      SchoolDTO,
      "logo_url" | "logo_wide" | "logo_wordmark" | "logo_attribution"
    >
  | undefined {
  const logo =
    school.unitid === undefined ? undefined : bundledLogos.get(school.unitid);
  if (!logo || school.slug !== logo.slug) return undefined;
  return {
    logo_url: `${bundledSchoolLogoBase() ?? ""}${logo.asset}`,
    ...(logo.width / logo.height > 1.5 ? { logo_wide: true } : {}),
    ...(unreadableSmall(logo) ? { logo_wordmark: true } : {}),
    logo_attribution: {
      author: logo.author,
      credit: logo.attribution,
      license: logo.license,
      license_url: logo.license_url,
      source_url: logo.source_url,
    },
  };
}

/**
 * Adds the bundled logo to a school summary from another endpoint. A summary
 * carries a slug and no unit ID, so the seed slug alone identifies the school.
 * A wordmark is left out: it is unreadable at the size a summary is shown.
 */
export function withBundledSchoolLogo<T extends { slug: string }>(
  school: T,
): WithSchoolLogo<T> {
  const logo = bundledLogosBySlug.get(school.slug);
  if (!logo || unreadableSmall(logo)) return school;
  return {
    ...school,
    logo_url: `${bundledSchoolLogoBase() ?? ""}${logo.asset}`,
  };
}

/** Adds the bundled logo to an event's host school. */
export function withHostSchoolLogo<T extends { host_school: { slug: string } }>(
  event: T,
): T & { host_school: WithSchoolLogo<T["host_school"]> } {
  return { ...event, host_school: withBundledSchoolLogo(event.host_school) };
}
