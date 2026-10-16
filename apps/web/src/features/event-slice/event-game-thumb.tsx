import { Gamepad2 } from "lucide-react";
import { useImageFailure } from "../../components/use-image-failure";

/**
 * The picture on an event row: the first game's portrait cover at a fixed
 * 3:4 size when the site serves one (never stretched to landscape), otherwise
 * a flat tile with a controller, which also stands in when the cover fails to
 * load so the row never shows a broken image. The row lists no game names,
 * so this picture names the event's games for screen readers: as the
 * cover's alt text, or as the tile's label. An event with no games gets a
 * decorative tile.
 */
export function EventGameThumb({
  games,
}: {
  games: ReadonlyArray<{ has_cover?: boolean; slug?: string; name?: string }>;
}) {
  const game = games[0];
  const names = games
    .map((each) => each.name)
    .filter(Boolean)
    .join(", ");
  const coverURL =
    game?.slug && game.has_cover
      ? `/api/games/${encodeURIComponent(game.slug)}/cover`
      : undefined;
  const { failed, onError, ref } = useImageFailure(coverURL);

  if (coverURL && !failed) {
    return (
      <img
        alt={names}
        className="event-game-thumb"
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
    <span
      aria-hidden={names ? undefined : true}
      aria-label={names || undefined}
      className="event-game-thumb event-game-thumb--fallback"
      role={names ? "img" : undefined}
    >
      <Gamepad2 aria-hidden="true" size={20} strokeWidth={1.75} />
    </span>
  );
}
