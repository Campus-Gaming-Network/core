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

export const ButtonLink = createLink(ButtonAnchor);
