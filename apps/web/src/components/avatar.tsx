import { userInitials } from "../features/public-profile/presentation";

// Avatars are cached for a day, so a change to the palette in
// server/avatar.server.ts needs a new version here for browsers to refetch.
const avatarVersion = 3;

/**
 * A user's avatar, drawn by this site. The initials sit underneath the picture,
 * so a picture that cannot load leaves them showing.
 */
export function Avatar({
  id,
  name,
  size = "large",
}: {
  id: string;
  name: string;
  size?: "small" | "medium" | "large";
}) {
  return (
    <span className={`avatar avatar--${size}`} aria-hidden="true">
      {userInitials(name)}
      <img
        alt=""
        height={80}
        loading="lazy"
        src={`/api/avatars/${encodeURIComponent(id)}?v=${avatarVersion}`}
        width={80}
      />
    </span>
  );
}
