import { Alert } from "@heroui/react/alert";
import { Button } from "@heroui/react/button";
import { EmptyState } from "@heroui/react/empty-state";
import { Input } from "@heroui/react/input";
import { ListBox } from "@heroui/react/list-box";
import { Select } from "@heroui/react/select";
import Link from "next/link";
import { EventBanner } from "../../components/event-banner";
import {
  eventLifecycleLabel,
  eventLocation,
  eventTimeRange
} from "../../lib/cgn-api";
import { currentProfile, listEvents, listGames } from "../../lib/server-api";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function EventsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const game = param(params.game);
  const school = param(params.school);
  const notice = param(params.event);
  const [profile, games, result] = await Promise.all([
    currentProfile(),
    listGames().catch(() => []),
    listEvents({ game, school, limit: 25 }).catch(() => ({
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
              Create event
            </Link>
          ) : (
            <Link className="button button--primary" href="/login?next=/events/new">
              Log in to create
            </Link>
          )}
        </div>
      </section>

      {notice ? <EventNotice status={notice} /> : null}

      <form action="/events" className="search-bar">
        <label>
          Game
          <Select fullWidth name="game" defaultSelectedKey={game}>
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
        <Button type="submit">Filter</Button>
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
              <small>{eventTimeRange(event)}</small>
              <small>
                {event.host_school.name} · {event.games.map((game) => game.name).join(", ")}
              </small>
              <small>{eventLocation(event)}</small>
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState>
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
    deleted: "Event deleted.",
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
