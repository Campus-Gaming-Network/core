import { useEffect, useState, type ReactNode } from "react";
import { formatTimestamp } from "./format-timestamp";

/**
 * Shows a timestamp in the viewing admin's time zone. The server cannot know
 * that zone, so the page renders in UTC and switches once it hydrates. Either
 * way the zone is named.
 */
export function Timestamp({ value }: { value: string }): ReactNode {
  const [timeZone, setTimeZone] = useState("UTC");

  useEffect(() => {
    setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  }, []);

  return <time dateTime={value}>{formatTimestamp(value, timeZone)}</time>;
}
