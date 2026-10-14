import type { EventsSearch } from "./contracts.js";

/**
 * The scope tabs above the events directory. Each scope stands for one value
 * of the `school`, `format`, or `type` filter; All events stands for none.
 */
export type EventScope = "all" | "my-school" | "online" | "tournaments";

/**
 * The scope that matches the current query. A query whose only scope filter
 * equals a tab's filter selects that tab. No scope filter, more than one, or a
 * value no tab stands for selects All events.
 */
export function currentEventScope(
  search: EventsSearch,
  homeSchoolSlug: string | undefined,
): EventScope {
  const { school, format, type } = search;
  const scopeFilters = [school, format, type].filter(Boolean).length;
  if (scopeFilters !== 1) return "all";
  if (school && school === homeSchoolSlug) return "my-school";
  if (format === "online") return "online";
  if (type === "tournament") return "tournaments";
  return "all";
}

/**
 * The query a scope tab links to: the game, audience, and cost filters stay,
 * the scope filters are replaced by the tab's own, and the page cursors and
 * any notice are dropped so the list starts from its first page.
 */
export function eventScopeSearch(
  search: EventsSearch,
  scope: EventScope,
  homeSchoolSlug: string | undefined,
): EventsSearch {
  return {
    ...(search.game ? { game: search.game } : {}),
    ...(scope === "my-school" && homeSchoolSlug
      ? { school: homeSchoolSlug }
      : {}),
    ...(scope === "online" ? { format: "online" as const } : {}),
    ...(search.audience ? { audience: search.audience } : {}),
    ...(scope === "tournaments" ? { type: "tournament" as const } : {}),
    ...(search.cost ? { cost: search.cost } : {}),
  };
}
