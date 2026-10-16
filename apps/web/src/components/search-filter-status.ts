export type SearchFilterState = "idle" | "loading" | "success" | "error";

/**
 * What a directory's search filter announces: a hint until the query is long
 * enough, then progress, then the outcome. `noun` is plural, such as "games".
 */
export function searchFilterMessage({
  count,
  minimumLength,
  noun,
  query,
  state,
}: {
  count: number;
  minimumLength: number;
  noun: string;
  query: string;
  state: SearchFilterState;
}): string {
  const trimmed = query.trim();
  if (trimmed.length < minimumLength) {
    return minimumLength > 1
      ? `Type at least ${minimumLength} characters to search ${noun}.`
      : `Type to search ${noun}.`;
  }
  if (state === "loading") return `Searching ${noun}…`;
  if (state === "error")
    return `We couldn’t search ${noun}. Check your connection and try again.`;
  if (count === 0)
    return `No ${noun} match “${trimmed}”. Try a different spelling or fewer words.`;
  return `${count} found. Use the arrow keys, then Enter to choose.`;
}
