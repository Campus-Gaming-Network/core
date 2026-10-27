import { Link, createFileRoute, notFound } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { BreadcrumbLink, Breadcrumbs } from "../components/breadcrumbs";
import { pageHead } from "../components/public-page-head";
import { RouteErrorView, RoutePending } from "../components/route-boundaries";
import { getEventActivity } from "../features/event-activity/activity.functions";
import { EventActivityList } from "../features/event-activity/activity-list";
import {
  eventActivityPageSize,
  validateEventActivitySearch,
  type EventActivityResult,
} from "../features/event-activity/contracts";
import { getEventDetail } from "../features/event-slice/event.functions";
import { PeoplePagination } from "../features/people-slice/people-views";
import eventCSS from "../features/event-slice/events.css?url";

type EventActivityRouteData = {
  event: { slug: string; title: string; timezone: string };
  activity: Exclude<EventActivityResult, { status: "not_found" }>;
  older: boolean;
  publicOrigin: string;
};

export const Route = createFileRoute("/events/$slug_/activity")({
  validateSearch: validateEventActivitySearch,
  loaderDeps: ({ search }) => ({ after: search.after }),
  loader: async ({
    context,
    deps,
    params,
  }): Promise<EventActivityRouteData> => {
    // The log read runs first: it is not found wherever the event page is
    // not. The detail read supplies the title and time zone and, like the
    // event page, runs last because of its cache policy.
    const activity = await getEventActivity({
      data: {
        slug: params.slug,
        limit: eventActivityPageSize,
        ...(deps.after ? { after: deps.after } : {}),
      },
    });
    if (activity.status === "not_found") throw notFound();

    const detail = await getEventDetail({ data: { slug: params.slug } });
    if (detail.status === "not_found") throw notFound();
    if (detail.status !== "found") {
      throw new Error("Event detail is unavailable");
    }
    if ("locked" in detail.event) throw notFound();

    return {
      event: {
        slug: detail.event.slug,
        title: detail.event.title,
        timezone: detail.event.timezone,
      },
      activity,
      older: Boolean(deps.after),
      publicOrigin: context.publicOrigin,
    };
  },
  staleTime: 0,
  headers: () => ({ "cache-control": "private, no-store", vary: "Cookie" }),
  head: ({ loaderData }) => {
    const head = pageHead(loaderData?.publicOrigin, {
      title: loaderData ? `Updates to ${loaderData.event.title}` : "Updates",
      description: "Changes made to this event.",
      path: loaderData
        ? `/events/${encodeURIComponent(loaderData.event.slug)}/activity`
        : "/events",
      noIndex: true,
    });
    return {
      ...head,
      links: [...head.links, { rel: "stylesheet", href: eventCSS }],
    };
  },
  pendingComponent: () => <RoutePending message="Loading updates…" />,
  errorComponent: () => (
    <RouteErrorView
      eyebrow="Updates unavailable"
      heading="We could not load this event's updates."
      description="Please try again in a moment."
      showNavigation={false}
    />
  ),
  component: EventActivityPage,
});

function EventActivityPage() {
  const { activity, event, older } = Route.useLoaderData();
  const nextCursor =
    activity.status === "found" ? activity.page.next_cursor : undefined;

  return (
    <main className="prose">
      <Breadcrumbs current="Updates">
        <BreadcrumbLink to="/events">Events</BreadcrumbLink>
        <BreadcrumbLink to="/events/$slug" params={{ slug: event.slug }}>
          {event.title}
        </BreadcrumbLink>
      </Breadcrumbs>
      <h1>Updates to {event.title}</h1>
      <p className="lede">
        Changes to this event, newest first. Times are in the event&apos;s time
        zone.
      </p>

      {activity.status === "unavailable" ? (
        <p className="muted">
          Updates are unavailable right now. Please check back soon.
        </p>
      ) : activity.page.entries.length === 0 ? (
        <p className="muted">
          {older ? "There are no older updates." : "No updates yet."}
        </p>
      ) : (
        <EventActivityList
          entries={activity.page.entries}
          timeZone={event.timezone}
        />
      )}

      <PeoplePagination
        label="Update pages"
        previous={
          older ? (
            <Link to="/events/$slug/activity" params={{ slug: event.slug }}>
              <ArrowLeft aria-hidden="true" size={16} strokeWidth={2} />
              Newest
            </Link>
          ) : undefined
        }
        next={
          nextCursor ? (
            <Link
              to="/events/$slug/activity"
              params={{ slug: event.slug }}
              search={{ after: nextCursor }}
            >
              Older
              <ArrowRight aria-hidden="true" size={16} strokeWidth={2} />
            </Link>
          ) : undefined
        }
      />
    </main>
  );
}
