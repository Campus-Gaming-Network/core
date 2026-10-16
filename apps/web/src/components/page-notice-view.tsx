import { CircleAlert, CircleCheck, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { PageNotice } from "./page-notice.js";

/**
 * The banner a page shows after a redirect, such as "RSVP saved." A failure is
 * an alert and stays until the page changes. A success can be dismissed, but
 * only once the page is interactive: without JavaScript there is no close
 * button and the notice simply stays. The icon and tint repeat what the words
 * say, so the state never rests on color alone.
 *
 * A live region only announces text added after it exists, and this banner
 * arrives already filled. So a success also fills a visually hidden polite
 * region after mount, which tells screen-reader users without moving focus
 * off the heading the root route focuses on navigation.
 */
export function PageNoticeView({ notice }: { notice?: PageNotice }) {
  const [interactive, setInteractive] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const message = notice?.message;

  useEffect(() => {
    setInteractive(true);
    setDismissed(false);
    setAnnouncement(message ?? "");
  }, [message]);

  if (!notice) return null;
  const danger = notice.severity === "danger";
  const Icon = danger ? CircleAlert : CircleCheck;
  return (
    <>
      {dismissed ? null : (
        <div
          className={`page-notice page-notice--${notice.severity}`}
          role={danger ? "alert" : undefined}
        >
          <Icon aria-hidden="true" size={20} strokeWidth={2} />
          <p>{notice.message}</p>
          {interactive && !danger ? (
            <button
              aria-label="Dismiss notice"
              className="page-notice__dismiss"
              onClick={() => {
                setDismissed(true);
                setAnnouncement("");
                // The button is gone, so hand focus back to the heading.
                const heading =
                  document.querySelector<HTMLElement>("#main-content h1");
                heading?.setAttribute("tabindex", "-1");
                heading?.focus();
              }}
              type="button"
            >
              <X aria-hidden="true" size={16} strokeWidth={2} />
            </button>
          ) : null}
        </div>
      )}
      {danger ? null : (
        <p aria-live="polite" className="visually-hidden" role="status">
          {announcement}
        </p>
      )}
    </>
  );
}
