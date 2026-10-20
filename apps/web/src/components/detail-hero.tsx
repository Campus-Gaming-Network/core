import type { ReactNode } from "react";
import { GameCoverImage } from "./game-cover-image";
import { SchoolLogo } from "./school-logo";

/**
 * The header of an event, school, or team page: a flat navy band with the
 * identity tile (a school logo, else an initial or a custom tile on the
 * school's tone, when there is one), the page's
 * own heading and supporting lines (`children`, which hold the one `h1`), and
 * on the right either a game's portrait cover at its own size or the page's
 * actions. The heading lives here and nowhere else on the page, so nothing is
 * said twice. Styles live in components.css.
 */
export function DetailHero({
  actions,
  children,
  coverURL,
  initial,
  logoURL,
  tile,
  tone,
}: {
  /** Controls at the right of the band, such as Follow. */
  actions?: ReactNode;
  children: ReactNode;
  /** A game's portrait cover, shown at its own 3:4 size when there are no actions. */
  coverURL?: string;
  /** The letter in the tile when there is no logo or `tile`. */
  initial?: string;
  logoURL?: string;
  /** Replaces the initial, such as a lock icon or a school's monogram. */
  tile?: ReactNode;
  /** A school's tone (`schoolTone`) behind the tile when there is no logo. */
  tone?: number;
}) {
  return (
    <header className="detail-hero">
      <span
        aria-hidden="true"
        className="detail-hero__tile"
        data-school-tone={tone}
      >
        {tile ?? initial?.trim().charAt(0).toUpperCase()}
        {logoURL ? <SchoolLogo eager logoURL={logoURL} size={88} /> : null}
      </span>
      <div className="detail-hero__body">{children}</div>
      {actions ? (
        <div className="detail-hero__actions">{actions}</div>
      ) : coverURL ? (
        <GameCoverImage className="detail-hero__cover" url={coverURL} />
      ) : null}
    </header>
  );
}
