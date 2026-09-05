export type BrowseQuery = Record<
  string,
  string | number | null | undefined
>;

export function browseHref(path: string, values: BrowseQuery) {
  const query = new URLSearchParams();

  for (const [name, value] of Object.entries(values)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    query.set(name, String(value));
  }

  return query.size > 0 ? `${path}?${query.toString()}` : path;
}

export function pageNumber(value: string) {
  if (!/^\d+$/.test(value)) {
    return 1;
  }
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}
