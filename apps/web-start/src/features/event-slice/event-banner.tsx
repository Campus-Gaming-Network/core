import type { EventDTO } from "./contracts.js";

type EventBannerData = {
  format: EventDTO["format"];
  games: ReadonlyArray<{ name: string }>;
  title: string;
};

type EventBannerProps = {
  event?: EventBannerData;
  locked?: boolean;
  size?: "compact" | "hero";
};

export function EventBanner({
  event,
  locked = false,
  size = "compact"
}: EventBannerProps) {
  const primaryGame = event?.games[0]?.name ?? "Campus Gaming Network";
  const label = locked
    ? "Private event"
    : event?.format.replace("_", " ") ?? "Campus event";

  return (
    <div
      aria-hidden="true"
      className={`event-banner event-banner--${size}`}
    >
      <span className="event-banner__mark">CGN</span>
      <span className="event-banner__copy">
        <small>{label}</small>
        <strong>{locked ? "Details locked" : primaryGame}</strong>
      </span>
    </div>
  );
}
