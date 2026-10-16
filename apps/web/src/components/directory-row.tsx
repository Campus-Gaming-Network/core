import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";
import { StatusLabel } from "./status-label";

/** Classes for the router link that wraps a `DirectoryRow`. */
export const directoryRowClassName = "list-item directory-row";

/**
 * The inside of one compact directory row, shared by the event, team, and
 * school directories (reference sheets 11 and 12): an identity tile, an
 * optional picture (an event's game cover), the name over a time line and a
 * muted host or location line, a group of tags, counts, and one small blue
 * action. On a wide list these sit in columns; narrower, the tags and counts
 * stack under the name and the action drops below. The caller wraps it in a
 * router link with `directoryRowClassName`, so the whole row is a single link
 * named by its text. Styles live in components.css.
 */
export function DirectoryRow({
  action,
  counts,
  detail,
  facts,
  identity,
  media,
  meta,
  name,
  status,
  tags = [],
}: {
  /** The one action's label, such as "View event". */
  action: string;
  counts?: ReactNode;
  /** A line under the name that only this kind of row has (an event's time). */
  detail?: string;
  /** Tags with their own tint (an event's `EventFacts`), shown first. */
  facts?: ReactNode;
  /** The tile before the name: a calendar date, team mark, or school logo. */
  identity: ReactNode;
  /** A decorative picture after the identity tile, hidden on phones. */
  media?: ReactNode;
  /** Host or school, then location; empty parts are left out. */
  meta: (string | undefined)[];
  name: string;
  /** A tinted state tag (Happening now, Full), shown before the others. */
  status?: ReactNode;
  /** Plain facts as neutral tags; a repeated label shows once. */
  tags?: string[];
}) {
  const metaLine = meta.filter(Boolean).join(" · ");

  return (
    <>
      <span className="directory-row__identity">{identity}</span>
      {media ? <span className="directory-row__media">{media}</span> : null}
      <span className="directory-row__copy">
        <strong className="directory-row__name">{name}</strong>
        {detail ? (
          <small className="directory-row__detail">{detail}</small>
        ) : null}
        {metaLine ? (
          <small className="directory-row__meta">{metaLine}</small>
        ) : null}
      </span>
      {status || facts || tags.length > 0 ? (
        <span className="directory-row__tags">
          {status}
          {facts}
          {[...new Set(tags)].map((tag) => (
            <StatusLabel key={tag}>{tag}</StatusLabel>
          ))}
        </span>
      ) : null}
      {counts ? <span className="directory-row__counts">{counts}</span> : null}
      <span className="directory-row__action">
        {action}
        <ArrowRight aria-hidden="true" size={14} strokeWidth={2.25} />
      </span>
    </>
  );
}
