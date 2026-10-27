import { Gamepad2 } from "lucide-react";
import { useImageFailure } from "../../components/use-image-failure";

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
        decoding="async"
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
