// What a school without a logo shows in its tile: a two-letter monogram on one
// of a fixed set of pale tones. Neither is the school's real branding; both
// only need to tell neighbouring tiles apart and stay the same everywhere a
// school shows. The tones themselves are in styles.css (`data-school-tone`).

export const schoolToneCount = 10;

// Words that say what kind of school it is rather than which one, compared
// without accents ("Université" is "universite").
const genericWords = new Set([
  "academy",
  "college",
  "colegio",
  "ecole",
  "escuela",
  "institute",
  "instituto",
  "school",
  "universidad",
  "universite",
  "university",
]);
const joiningWords = new Set([
  "&",
  "and",
  "at",
  "de",
  "del",
  "for",
  "in",
  "la",
  "of",
  "on",
  "the",
]);
const plain = (word: string) =>
  word.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/**
 * Up to two capitals for a school's tile: the first letters of the first two
 * words that name the school, skipping a leading "University of", "College of
 * the", and so on. A campus after the hyphen ("Rutgers University-Newark") is
 * left out, so a school's campuses share a monogram as they share a name.
 * Only the name is used, because every school summary carries it.
 */
export function schoolMonogram(name: string): string {
  const words = (name.split("-")[0] ?? name)
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}\p{N}&]/gu, ""))
    .filter((word) => word && !joiningWords.has(plain(word)));
  const firstNaming = words.findIndex((word) => !genericWords.has(plain(word)));
  const naming = firstNaming === -1 ? words : words.slice(firstNaming);
  const monogram = naming
    .slice(0, 2)
    .map((word) => word.charAt(0).toLocaleUpperCase("en-US"))
    .join("");
  // "Del-Mar-Va Beauty Academy" leaves only "Del", a joining word.
  return monogram || name.trim().charAt(0).toLocaleUpperCase("en-US");
}

/**
 * A tone from 0 to `schoolToneCount - 1`, fixed by the school's slug (FNV-1a),
 * so a school keeps its tone on every page and after every deploy.
 */
export function schoolTone(slug: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < slug.length; index += 1) {
    hash ^= slug.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % schoolToneCount;
}
