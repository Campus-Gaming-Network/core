import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";
import { StatusLabel } from "./status-label";

/** Classes for the router link that wraps a `DirectoryRow`. */
export const directoryRowClassName =
  "card card--default list-item directory-row";

/**
 * The inside of one compact directory row, shared by the event, team, and
 * school directories: an identity tile, the name, a muted meta line (host or
 * school, then location), a group of labels, counts, and one action.
 * The caller wraps it in a router link with `directoryRowClassName`, so the
 * whole row is a single link named by its text. On a phone the row stacks in
 * the same order, with the action last. Styles live in components.css.
 */
export function DirectoryRow({
  action,
  counts,
  detail,
  facts,
  identity,
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
  /** Labels that carry their own icon and color (an event's `EventFacts`),
   * shown first in the label group. */
  facts?: ReactNode;
  /** The tile before the name: a calendar date, team mark, or school logo. */
  identity: ReactNode;
  /** Host or school, then location; empty parts are left out. */
  meta: (string | undefined)[];
  name: string;
  /** A colored state label above the name, when there is one to show. */
  status?: ReactNode;
  /** Plain facts as neutral outlined labels; a repeated label shows once. */
  tags?: string[];
}) {
  return (
    <>
      <span className="directory-row__identity">{identity}</span>
      <span className="directory-row__copy">
        {status}
        <strong className="directory-row__name">{name}</strong>
        {detail ? (
          <small className="directory-row__detail">{detail}</small>
        ) : null}
        <small className="directory-row__meta">
          {meta.filter(Boolean).join(" · ")}
        </small>
        {facts || tags.length > 0 ? (
          <span className="directory-row__tags">
            {facts}
            {[...new Set(tags)].map((tag) => (
              <StatusLabel key={tag}>{tag}</StatusLabel>
            ))}
          </span>
        ) : null}
        {counts}
      </span>
      <span className="directory-row__action with-arrow">
        {action}
        <ArrowRight aria-hidden="true" size={14} strokeWidth={2.25} />
      </span>
    </>
  );
}
