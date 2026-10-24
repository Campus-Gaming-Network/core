import type { EventDTO } from "../event-slice/contracts";
import type { EventActivityEntry } from "./contracts";
import { eventActivityLine } from "./presentation";

/**
 * Log entries, newest first, in the words the viewer may see: an editor's
 * view names who made each change. Styles live under "Activity log" in
 * events.css.
 */
export function EventActivityList({
  entries,
  timeZone,
}: {
  entries: EventActivityEntry[];
  timeZone: EventDTO["timezone"];
}) {
  return (
    <ol className="activity-list">
      {entries.map((entry) => {
        const line = eventActivityLine(entry, timeZone);
        return (
          <li key={entry.id}>
            <p className="activity-list__summary">
              <strong>{line.summary}</strong>
              {line.author ? <> by {line.author}</> : null}
            </p>
            {line.details.length > 0 ? (
              <ul className="activity-list__details">
                {line.details.map((detail) => (
                  <li key={detail}>{detail}</li>
                ))}
              </ul>
            ) : null}
            <time className="activity-list__when" dateTime={entry.occurred_at}>
              {line.when}
            </time>
          </li>
        );
      })}
    </ol>
  );
}
