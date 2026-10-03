import { CircleAlert, CircleCheck } from "lucide-react";
import type { PageNotice } from "./page-notice.js";

/**
 * The banner a page shows after a redirect, such as "RSVP saved." A failure is
 * an alert; anything else is a status. The icon and tint repeat what the words
 * say, so the state never rests on color alone.
 */
export function PageNoticeView({ notice }: { notice?: PageNotice }) {
  if (!notice) return null;
  const Icon = notice.severity === "danger" ? CircleAlert : CircleCheck;
  return (
    <div
      className={`page-notice page-notice--${notice.severity}`}
      role={notice.severity === "danger" ? "alert" : "status"}
      aria-live="polite"
    >
      <Icon aria-hidden="true" size={20} strokeWidth={2} />
      <p>{notice.message}</p>
    </div>
  );
}
