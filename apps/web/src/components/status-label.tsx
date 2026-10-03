import type { ReactNode } from "react";

/**
 * A short label that pairs a state's name with a color. `status` picks the
 * color for an event lifecycle (`upcoming`, `happening_now`, `full`, or
 * `ended`); without one, the label is the neutral outlined variant used for
 * plain facts such as an event's format. Colors live in components.css.
 */
export function StatusLabel({
  children,
  status,
}: {
  children: ReactNode;
  status?: string;
}) {
  return (
    <span
      className={status ? `event-status event-status--${status}` : "event-pill"}
    >
      {children}
    </span>
  );
}
