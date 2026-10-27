export interface NavigationChange {
  fromPathname: string | undefined;
  toPathname: string;
  toHash: string;
}

/**
 * A client-side navigation moves focus and announces the page only when it
 * lands on a different path. The first render has no previous location (the
 * server-rendered load), a search-only change leaves the path alone (filters
 * manage their own focus), and a hash target belongs to the browser's scroll.
 */
export function shouldMoveFocus({
  fromPathname,
  toPathname,
  toHash,
}: NavigationChange): boolean {
  if (fromPathname === undefined) return false;
  if (toHash !== "") return false;
  return fromPathname !== toPathname;
}

export function pageAnnouncement(title: string, heading: string): string {
  return title.trim() || heading.trim();
}
