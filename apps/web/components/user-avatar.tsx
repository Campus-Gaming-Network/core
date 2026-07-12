"use client";

import { userInitials } from "../lib/cgn-api";

type UserAvatarProps = {
  avatarURL?: string;
  name: string;
};

export function UserAvatar({ avatarURL, name }: UserAvatarProps) {
  return (
    <div className="avatar" aria-hidden="true">
      <span>{userInitials(name)}</span>
      {avatarURL ? (
        <img
          alt=""
          onError={(event) => {
            event.currentTarget.hidden = true;
          }}
          src={avatarURL}
        />
      ) : null}
    </div>
  );
}
