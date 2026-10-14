import type { ReactNode } from "react";

/**
 * The header of a detail page (an event, a school, a team): an identity mark
 * (a school logo, a team mark, or a `CalendarDate`), the page's one `h1`, a
 * supporting line such as the host or location, tags, and actions. Actions sit
 * to the right on a wide screen and below the heading on a phone. Every slot
 * but the title is optional. `level={2}` is for the style guide's specimen,
 * which sits on a page that already has its `h1`. Styles live in
 * components.css.
 */
export function PageHeading({
  actions,
  identity,
  level = 1,
  supporting,
  tags,
  title,
}: {
  actions?: ReactNode;
  identity?: ReactNode;
  level?: 1 | 2;
  supporting?: ReactNode;
  tags?: ReactNode;
  title: ReactNode;
}) {
  const Heading = level === 1 ? "h1" : "h2";

  return (
    <header className="detail-heading">
      {identity ? (
        <div className="detail-heading__identity">{identity}</div>
      ) : null}
      <div className="detail-heading__body">
        <Heading className="detail-heading__title">{title}</Heading>
        {supporting ? (
          <p className="detail-heading__supporting">{supporting}</p>
        ) : null}
        {tags ? <div className="detail-heading__tags">{tags}</div> : null}
      </div>
      {actions ? (
        <div className="detail-heading__actions">{actions}</div>
      ) : null}
    </header>
  );
}
