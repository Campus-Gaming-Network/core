import { Gamepad2 } from "lucide-react";
import { useImageFailure } from "../../components/use-image-failure";

/**
 * A small fixed-size portrait cover for a picker row, or a flat tile with a
 * controller when the catalog serves no cover or it fails to load. It is
 * decoration: the row's text names the game.
 */
export function GameTile({ coverURL }: { coverURL?: string }) {
  const { failed, onError, ref } = useImageFailure(coverURL);
  if (coverURL && !failed) {
    return (
      <img
        alt=""
        className="game-tile"
        decoding="async"
        height={48}
        loading="lazy"
        onError={onError}
        ref={ref}
        src={coverURL}
        width={36}
      />
    );
  }
  return (
    <span aria-hidden="true" className="game-tile game-tile--fallback">
      <Gamepad2 size={16} strokeWidth={1.75} />
    </span>
  );
}
