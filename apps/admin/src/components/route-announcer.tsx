import { useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { pageAnnouncement, shouldMoveFocus } from "./route-focus";

/**
 * Moves focus to the new page's main heading (or the content area when a
 * page has none) after a client-side navigation and announces the page title
 * in a polite live region. Focus is placed without scrolling, so the router's
 * scroll restoration stays in charge of the scroll position.
 */
export function RouteAnnouncer() {
  const router = useRouter();
  const [announcement, setAnnouncement] = useState("");

  useEffect(
    () =>
      router.subscribe("onRendered", (event) => {
        if (
          !shouldMoveFocus({
            fromPathname: event.fromLocation?.pathname,
            toPathname: event.toLocation.pathname,
            toHash: event.toLocation.hash,
          })
        ) {
          return;
        }
        // Wait two frames so the new route is committed and its title applied.
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const main = document.getElementById("main-content");
            const heading = main?.querySelector<HTMLElement>("h1") ?? null;
            const target = heading ?? main;
            target?.setAttribute("tabindex", "-1");
            target?.focus({ preventScroll: true });
            setAnnouncement(
              pageAnnouncement(document.title, heading?.textContent ?? ""),
            );
          });
        });
      }),
    [router],
  );

  return (
    <div
      aria-atomic="true"
      aria-live="polite"
      className="sr-only"
      role="status"
    >
      {announcement}
    </div>
  );
}
