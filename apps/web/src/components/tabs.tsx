import { createLink } from "@tanstack/react-router";
import type { ComponentPropsWithRef, ReactNode } from "react";

/**
 * Section links drawn as underline tabs. Each tab is a `TabLink`; they are
 * plain links, so they work without JavaScript, and the current one carries
 * `aria-current="page"`. Styles live under "Tabs" in components.css.
 */
export function Tabs({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <nav aria-label={label} className="tabs">
      {children}
    </nav>
  );
}

function TabAnchor({
  current,
  ...props
}: Omit<ComponentPropsWithRef<"a">, "aria-current" | "className"> & {
  current: boolean;
}) {
  return (
    <a
      {...props}
      aria-current={current ? "page" : undefined}
      className="tabs__link"
    />
  );
}

/**
 * One tab in `Tabs`: a router link that takes the same `to`, `params`, and
 * `search` props as `Link`, plus `current` for the tab being shown.
 */
export const TabLink = createLink(TabAnchor);
