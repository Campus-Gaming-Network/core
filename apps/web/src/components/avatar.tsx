import { userInitials } from "../features/public-profile/presentation";

/**
 * A user's avatar, drawn by this site. The initials sit underneath the picture,
 * so a picture that cannot load leaves them showing.
 */
export function Avatar({ id, name }: { id: string; name: string }) {
  return (
    <span className="avatar avatar--large" aria-hidden="true">
      {userInitials(name)}
      <img
        alt=""
        height={80}
        loading="lazy"
        src={`/api/avatars/${encodeURIComponent(id)}`}
        width={80}
      />
    </span>
  );
}
