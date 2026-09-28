import type { PageNotice } from "./page-notice.js";

export function PageNoticeView({ notice }: { notice?: PageNotice }) {
  if (!notice) return null;
  return (
    <p
      role={notice.severity === "danger" ? "alert" : "status"}
      aria-live="polite"
    >
      {notice.message}
    </p>
  );
}
