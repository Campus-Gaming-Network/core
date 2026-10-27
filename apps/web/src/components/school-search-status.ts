import type { SearchFilterState } from "./search-filter-status.js";

export function schoolSearchMessage({
  state,
  query,
  count,
}: {
  state: SearchFilterState;
  query: string;
  count: number;
}): string {
  const trimmed = query.trim();
  if (trimmed.length < 2) return "Type at least two characters to search.";
  if (state === "loading") return "Searching schools…";
  if (state === "error")
    return "We couldn’t load schools. Check your connection and try again.";
  if (count === 0)
    return `No schools match “${trimmed}”. Try a different spelling or fewer words.`;
  return `${count} school${count === 1 ? "" : "s"} found. Use the arrow keys, then Enter to choose.`;
}
