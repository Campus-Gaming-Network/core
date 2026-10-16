import { Gamepad2 } from "lucide-react";
import { useImageFailure } from "../../components/use-image-failure";

/**
 * A game's portrait cover beside its name on the event page, or the controller
 * tile of the same size when there is no cover or it fails to load.
 */
export function EventGameCover({
  hasCover,
  slug,
}: {
  hasCover: boolean;
  slug: string;
}) {
  const coverURL = hasCover
    ? `/api/games/${encodeURIComponent(slug)}/cover`
    : undefined;
  const { failed, onError, ref } = useImageFailure(coverURL);

  if (coverURL && !failed) {
    return (
      <img
        alt=""
        className="event-game-cover"
        height={64}
        loading="lazy"
        onError={onError}
        ref={ref}
        src={coverURL}
        width={48}
      />
    );
  }

  return (
    <span className="event-game-cover" aria-hidden="true">
      <Gamepad2 size={18} strokeWidth={2} />
    </span>
  );
}
