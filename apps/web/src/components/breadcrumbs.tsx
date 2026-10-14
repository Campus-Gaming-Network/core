import { createLink } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { Children, type ComponentPropsWithRef, type ReactNode } from "react";

/**
 * The trail above a detail page's heading. Pass the parent pages as
 * `BreadcrumbLink`s in order, and the page itself as `current`: it ends the
 * list as plain text marked `aria-current="page"`. The separators are
 * decorative icons.
 */
export function Breadcrumbs({
  children,
  current,
}: {
  children: ReactNode;
  current: string;
}) {
  const separator = (
    <ChevronRight
      aria-hidden="true"
      className="breadcrumbs__separator"
      size={14}
      strokeWidth={2.25}
    />
  );

  return (
    <nav aria-label="Breadcrumb" className="breadcrumbs">
      <ol>
        {Children.toArray(children).map((link, index) => (
          <li key={index}>
            {link}
            {separator}
          </li>
        ))}
        <li>
          <span aria-current="page">{current}</span>
        </li>
      </ol>
    </nav>
  );
}

// The router marks a link to a parent path (/events on an event page) as
// the current page. Only the last crumb is current, so a parent drops it.
function BreadcrumbAnchor({
  "aria-current": _current,
  ...props
}: ComponentPropsWithRef<"a">) {
  return <a {...props} />;
}

/**
 * A parent page in `Breadcrumbs`: a router link that takes the same `to`,
 * `params`, and `search` props as `Link`.
 */
export const BreadcrumbLink = createLink(BreadcrumbAnchor);
