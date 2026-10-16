/** One applied directory filter, as the page's search holds it. */
export type AppliedFilter = {
  /** The search parameter that carries the filter. */
  key: string;
  /** The filter's name, such as "Game". */
  name: string;
  /** The raw search value. */
  value: string;
  /** The readable value, such as the game's name. */
  label: string;
};

export type FilterChip = {
  key: string;
  /** The chip text, such as "Game: Valorant". */
  text: string;
  /** The query that drops only this filter. */
  search: Record<string, string>;
};

/**
 * One chip per applied filter. Each chip's search keeps every other filter
 * and carries no page cursor, so removing a filter starts from page one.
 */
export function activeFilterChips(filters: AppliedFilter[]): FilterChip[] {
  return filters.map((filter) => ({
    key: filter.key,
    text: `${filter.name}: ${filter.label}`,
    search: Object.fromEntries(
      filters
        .filter((other) => other.key !== filter.key)
        .map((other) => [other.key, other.value]),
    ),
  }));
}

/**
 * The chip to offer first when nothing matches. `restrictiveOrder` lists
 * filter keys from the one that narrows results most to the one that narrows
 * them least; chips for keys it omits come last.
 */
export function mostRestrictiveChip(
  chips: FilterChip[],
  restrictiveOrder: string[],
): FilterChip | undefined {
  const rank = (chip: FilterChip) => {
    const index = restrictiveOrder.indexOf(chip.key);
    return index === -1 ? restrictiveOrder.length : index;
  };
  let narrowest: FilterChip | undefined;
  for (const chip of chips)
    if (!narrowest || rank(chip) < rank(narrowest)) narrowest = chip;
  return narrowest;
}

/**
 * The query a filter form submits: every named field with a value. Fields
 * left on their "all" option are empty and drop out, and no page cursor is
 * ever a form field, so applying a filter starts from the first page.
 */
export function filterFormSearch(
  entries: Iterable<[string, FormDataEntryValue]>,
): Record<string, string> {
  const search: Record<string, string> = {};
  for (const [name, value] of entries) {
    if (typeof value === "string" && value.trim() !== "") search[name] = value;
  }
  return search;
}

/** The sentence a live region announces after the results change. */
export function resultsAnnouncement(
  count: number,
  noun: string,
  filterCount: number,
): string {
  const found = `${count} ${noun}${count === 1 ? "" : "s"} found`;
  if (filterCount === 0) return `${found}.`;
  return `${found} with ${filterCount} filter${filterCount === 1 ? "" : "s"} applied.`;
}
