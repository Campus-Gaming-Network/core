import type { ReactNode } from "react";

/** The tag tint for each event lifecycle. */
const lifecycleTones: Record<string, Tone> = {
  upcoming: "info",
  happening_now: "success",
  full: "danger",
  ended: "neutral",
};

type Tone = "neutral" | "info" | "success" | "warning" | "danger" | "admin";

/**
 * A short tag. `status` picks the tint for an event lifecycle (`upcoming`,
 * `happening_now`, `full`, or `ended`); `tone` picks one directly. Without
 * either it is the neutral gray tag used for plain facts. `admin` marks a site
 * administrator. The words always
 * carry the meaning, so nothing rests on color alone. Styles live under
 * "Tags" in styles.css.
 */
export function StatusLabel({
  children,
  status,
  tone,
}: {
  children: ReactNode;
  status?: string;
  tone?: Tone;
}) {
  const resolved = tone ?? (status ? lifecycleTones[status] : undefined);
  return (
    <span
      className={
        resolved && resolved !== "neutral" ? `tag tag--${resolved}` : "tag"
      }
    >
      {children}
    </span>
  );
}
