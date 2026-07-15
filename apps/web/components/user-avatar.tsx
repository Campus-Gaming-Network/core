"use client";

import { Avatar } from "@heroui/react/avatar";
import { userInitials } from "../lib/cgn-api";

type UserAvatarProps = {
  avatarURL?: string;
  name: string;
};

export function UserAvatar({ avatarURL, name }: UserAvatarProps) {
  return (
    <Avatar className="avatar" aria-hidden="true">
      {avatarURL ? (
        <Avatar.Image
          alt=""
          onError={(event) => {
            event.currentTarget.hidden = true;
          }}
          src={avatarURL}
        />
      ) : null}
      <Avatar.Fallback>{userInitials(name)}</Avatar.Fallback>
    </Avatar>
  );
}
