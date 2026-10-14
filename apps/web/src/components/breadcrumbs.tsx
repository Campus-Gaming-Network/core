import { ChevronRight } from "lucide-react";
import { Children, type ReactNode } from "react";

/**
 * The trail above a detail page's heading. Pass the parent pages as router
 * links in order, and the page itself as `current`: it ends the list as plain
 * text marked `aria-current="page"`. The separators are decorative icons.
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
