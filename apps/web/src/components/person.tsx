import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Avatar } from "./avatar";

export function Person({
  detail,
  id,
  name,
  profileId,
}: {
  detail?: ReactNode;
  id: string;
  name: string;
  profileId?: string;
}) {
  return (
    <span className="person">
      <Avatar id={id} name={name} size="medium" />
      <span className="person__text">
        {profileId ? (
          <Link to="/users/$id" params={{ id: profileId }}>
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
