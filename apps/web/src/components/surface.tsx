import type { ComponentProps } from "react";

const surfaceClasses = {
  panel: "panel",
  flush: "panel panel--flush",
  action: "action-panel",
  card: "detail-card",
  empty: "empty-state",
} as const;

/**
 * A white bounded box on the canvas. `panel` pads its content, `flush` lets a
 * list or table reach its edges (with `.panel__header` and `.panel__body`
 * inside), `action` holds a page's call to action, `card` is a side-panel
 * card with `.detail-card-body` rows, and `empty` is a list's empty or
 * unavailable state. `className` adds the caller's own class after the
 * surface's.
 */
export function Surface({
  as: Element = "section",
  className,
  variant,
  ...props
}: Omit<ComponentProps<"section">, "ref"> & {
  as?: "div" | "header" | "section";
  variant: keyof typeof surfaceClasses;
}) {
  return (
    <Element
      {...props}
      className={
        className
          ? `${surfaceClasses[variant]} ${className}`
          : surfaceClasses[variant]
      }
    />
  );
}
