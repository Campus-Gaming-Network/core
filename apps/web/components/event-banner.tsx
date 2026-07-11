import { type Event } from "../lib/cgn-api";

type EventBannerProps = {
  event?: Pick<Event, "format" | "games" | "title">;
  locked?: boolean;
  size?: "compact" | "hero";
};

export function EventBanner({
  event,
  locked = false,
  size = "compact"
}: EventBannerProps) {
  const primaryGame = event?.games[0]?.name ?? "Campus Gaming Network";
  const label = locked ? "Private event" : event?.format?.replace("_", " ") ?? "Campus event";

  return (
    <div
      aria-label="Default event banner"
      className={`event-banner ${size}`}
      role="img"
    >
      <span className="event-banner-mark">CGN</span>
      <span className="event-banner-copy">
        <small>{label}</small>
        <strong>{locked ? "Details locked" : primaryGame}</strong>
      </span>
    </div>
  );
}
