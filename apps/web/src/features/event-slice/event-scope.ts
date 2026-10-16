import type { EventsSearch } from "./contracts.js";

/**
 * The scope tabs above the events directory. Each scope stands for one value
 * of the `school`, `format`, or `type` filter; All events stands for none.
 */
export type EventScope = "all" | NonNullable<EventsSearch["scope"]>;

/**
 * The tab the viewer chose, named by the query's `scope`. A filter alone
 * never selects a tab, so choosing Online as the format under All events
 * stays on All events. A `scope` whose filter is missing or changed (an
 * edited link, a home school that is no longer the viewer's) selects All
 * events.
 */
export function currentEventScope(
  search: EventsSearch,
  homeSchoolSlug: string | undefined,
): EventScope {
  const { scope, school, format, type } = search;
  if (scope === "my-school" && homeSchoolSlug && school === homeSchoolSlug)
    return scope;
  if (scope === "online" && format === "online") return scope;
  if (scope === "tournaments" && type === "tournament") return scope;
  return "all";
}

/**
 * The query a scope tab links to: the tab's own `scope`, then the game,
 * audience, and cost filters stay,
 * the scope filters are replaced by the tab's own, and the page cursors and
 * any notice are dropped so the list starts from its first page.
 */
export function eventScopeSearch(
  search: EventsSearch,
  scope: EventScope,
  homeSchoolSlug: string | undefined,
): EventsSearch {
  return {
    ...(scope === "all" ? {} : { scope }),
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
