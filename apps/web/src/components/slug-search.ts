const maxWords = 5;

/**
 * Turns a slug nobody matched into search words, so a not-found page can offer
 * a search for what the visitor was probably after: "valorant-night-2026"
 * becomes "valorant night 2026". Returns an empty string when the slug holds
 * nothing worth searching for.
 */
export function slugSearchWords(slug: string): string {
  let decoded = slug;
  try {
    decoded = decodeURIComponent(slug);
  } catch {
    // A malformed escape stays as written; the split below drops its symbols.
  }

  return (
    decoded
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length > 1)
      .slice(0, maxWords)
      .join(" ")
      // A search is capped well below this, but keep a hostile slug bounded.
      .slice(0, 80)
      .trim()
  );
}
