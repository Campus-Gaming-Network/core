import type { PolicySection } from "../policies/policy-document.js";

/** Below this many sections a document is short enough to scan without a contents list. */
export const minimumSectionsForContents = 3;

function headingSlug(heading: string): string {
  return heading
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Each section with the anchor its heading carries: its own `id`, or a slug
 * of the heading. A repeated anchor gets a numeric suffix so no two headings
 * share one.
 */
export function anchoredSections(
  sections: readonly PolicySection[],
): (PolicySection & { id: string })[] {
  const used = new Set<string>();
  return sections.map((section) => {
    const base = section.id ?? (headingSlug(section.heading) || "section");
    let id = base;
    for (let n = 2; used.has(id); n += 1) id = `${base}-${n}`;
    used.add(id);
    return { ...section, id };
  });
}
