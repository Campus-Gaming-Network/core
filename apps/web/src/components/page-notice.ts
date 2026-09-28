/**
 * A message a page shows after a redirect names it in the query string, such
 * as `?event=rsvp-failed`. Each page defines the notices it can receive, so a
 * failure always renders as an alert and an unknown value renders nothing.
 */
export type PageNotice = {
  message: string;
  severity: "success" | "danger";
};

/** Returns the notice key for a query-string value the page defines. */
export function pageNoticeKey<Key extends string>(
  notices: Readonly<Record<Key, PageNotice>>,
  value: unknown,
): Key | undefined {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (typeof candidate !== "string") return undefined;
  const key = candidate.trim();
  return Object.hasOwn(notices, key) ? (key as Key) : undefined;
}
