import { Alert } from "@heroui/react/alert";
import { Button } from "@heroui/react/button";
import { EmptyState } from "@heroui/react/empty-state";
import { Input } from "@heroui/react/input";
import { ListBox } from "@heroui/react/list-box";
import { Select } from "@heroui/react/select";
import Link from "next/link";
import { EventBanner } from "../../../components/event-banner";
import { Icon, appIcon } from "../../../components/icon";
import {
  eventLifecycleLabel,
  eventLocation,
  eventTimeRange
} from "../../../lib/cgn-api";
import { currentProfile, listEvents, listGames } from "../../../lib/server-api";
import { pageMetadata } from "../../../lib/metadata";

export const metadata = pageMetadata({
  title: "Events",
  description:
    "Browse upcoming collegiate gaming events and filter them by game or school.",
  path: "/events"
});

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function EventsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const game = param(params.game);
  const school = param(params.school);
  const format = param(params.format);
  const notice = param(params.event);
  const [profile, games, result] = await Promise.all([
    currentProfile(),
    listGames().catch(() => []),
    listEvents({ game, school, format, limit: 25 }).catch(() => ({
      events: [],
      limit: 25,
      offset: 0
    }))
  ]);

  return (
    <main className="narrow">
      <section className="page-heading">
        <p className="eyebrow">Events</p>
        <h1>Browse campus gaming events</h1>
        <p className="lede">
          Find public events by game or school. Unlisted events are available by
          direct link, and private events stay locked until unlocked.
        </p>
        <div className="actions">
          {profile ? (
            <Link className="button button--primary" href="/events/new">
              <Icon icon={appIcon.create} />
              Create event
            </Link>
          ) : (
            <Link className="button button--primary" href="/login?next=/events/new">
              <Icon icon={appIcon.logIn} />
              Log in to create
            </Link>
          )}
        </div>
      </section>

      {notice ? <EventNotice status={notice} /> : null}

      <form action="/events" className="search-bar">
        <label>
          Game
          <Select
            fullWidth
            name="game"
            defaultSelectedKey={game}
            aria-label="Filter events by game"
          >
            <Select.Trigger>
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                <ListBox.Item id="" textValue="All games">All games</ListBox.Item>
                {games.map((gameOption) => (
                  <ListBox.Item
                    id={gameOption.slug}
                    key={gameOption.id}
                    textValue={gameOption.name}
                  >
                    {gameOption.name}
                  </ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>
        </label>
        <label>
          School slug
          <Input
            name="school"
            defaultValue={school}
            placeholder="university-of-california-irvine"
          />
        </label>
        <label>
          Format
          <Select
            fullWidth
            name="format"
            defaultSelectedKey={format}
            aria-label="Filter events by format"
          >
            <Select.Trigger>
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                <ListBox.Item id="" textValue="All formats">All formats</ListBox.Item>
                <ListBox.Item id="online" textValue="Online">Online</ListBox.Item>
                <ListBox.Item id="in_person" textValue="In person">In person</ListBox.Item>
                <ListBox.Item id="hybrid" textValue="Hybrid">Hybrid</ListBox.Item>
              </ListBox>
            </Select.Popover>
          </Select>
        </label>
        <Button type="submit">
          <Icon icon={appIcon.filter} />
          Filter
        </Button>
      </form>

      {result.events.length > 0 ? (
        <div className="list">
          {result.events.map((event) => (
            <Link className="card card--default list-item block" href={`/events/${event.slug}`} key={event.id}>
              <EventBanner event={event} />
              <span className="event-card-heading">
                <strong>{event.title}</strong>
                <small>{eventLifecycleLabel(event.lifecycle)}</small>
              </span>
              <small className="icon-text">
                <Icon icon={appIcon.time} size="sm" />
                {eventTimeRange(event)}
              </small>
              <small className="icon-text">
                <Icon icon={appIcon.school} size="sm" />
                {event.host_school.name} · {event.games.map((eventGame) => eventGame.name).join(", ")}
              </small>
              <small className="icon-text">
                <Icon icon={appIcon.place} size="sm" />
                {eventLocation(event)}
              </small>
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState>
          <span className="icon-badge">
            <Icon icon={appIcon.notFound} size="xl" />
          </span>
          <h2>No public events found</h2>
          <p>
            Try clearing filters or create the first event for your campus.
          </p>
        </EmptyState>
      )}
    </main>
  );
}

function EventNotice({ status }: { status: string }) {
  const messages: Record<string, string> = {
    cancelled: "Event cancelled.",
    "cancel-failed": "We could not cancel that event. Please try again.",
    deleted: "Event cancelled.",
    failed: "We could not update that event. Please try again."
  };

  return (
    <Alert
      status={status === "failed" ? "danger" : "success"}
    >
      {messages[status] ?? ""}
    </Alert>
  );
}

function param(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}
