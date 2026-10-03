import { createLink } from "@tanstack/react-router";
import type { ComponentPropsWithRef } from "react";

function ButtonAnchor({
  variant,
  ...props
}: Omit<ComponentPropsWithRef<"a">, "className"> & {
  variant: "primary" | "secondary";
}) {
  return <a {...props} className={`button button--${variant}`} />;
}

/**
 * A router link drawn as a button. It takes the same `to`, `params`, and
 * `search` props as `Link`, checked against the route tree, plus a `variant`
 * for the `.button--primary` or `.button--secondary` treatment.
 */
export const ButtonLink = createLink(ButtonAnchor);
