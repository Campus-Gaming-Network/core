import type { ComponentPropsWithRef } from "react";

/**
 * A native button with the site's variant classes. A submit button with no
 * variant is drawn as primary by styles.css, and any other button as the plain
 * bordered one. A pending form disables its button and names what is
 * happening in the label ("Saving…"). `className` adds the caller's own class
 * after the variant's.
 */
export function Button({
  className,
  size,
  variant,
  ...props
}: ComponentPropsWithRef<"button"> & {
  size?: "small";
  variant?: "primary" | "secondary" | "destructive";
}) {
  const classes = [
    variant ? `button--${variant}` : "",
    size ? `button--${size}` : "",
    className ?? "",
  ].filter(Boolean);
  return (
    <button
      {...props}
      className={classes.length > 0 ? classes.join(" ") : undefined}
    />
  );
}
