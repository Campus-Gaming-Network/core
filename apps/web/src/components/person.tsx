import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Avatar } from "./avatar";

/**
 * A person in a list: their avatar beside their name and a line of detail.
 * `linked` makes the name a link to their public profile.
 */
export function Person({
  detail,
  id,
  linked = false,
  name,
}: {
  detail?: ReactNode;
  id: string;
  linked?: boolean;
  name: string;
}) {
  return (
    <span className="person">
      <Avatar id={id} name={name} size="medium" />
      <span className="person__text">
        {linked ? (
          <Link to="/users/$id" params={{ id }}>
            {name}
          </Link>
        ) : (
          <strong>{name}</strong>
        )}
        {detail ? <small>{detail}</small> : null}
      </span>
    </span>
  );
}
