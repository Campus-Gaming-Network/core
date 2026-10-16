import { useImageFailure } from "./use-image-failure";

/**
 * A game's portrait cover in a page header, at its own 3:4 size and never
 * stretched. It is above the fold, so it loads eagerly; one that fails to
 * load is dropped. It is decoration: the page names the game.
 */
export function GameCoverImage({
  className,
  url,
}: {
  className: string;
  url: string;
}) {
  const cover = useImageFailure(url);
  if (cover.failed) return null;
  return (
    <img
      alt=""
      className={className}
      decoding="async"
      fetchPriority="high"
      height={112}
      loading="eager"
      onError={cover.onError}
      ref={cover.ref}
      src={url}
      width={84}
    />
  );
}
