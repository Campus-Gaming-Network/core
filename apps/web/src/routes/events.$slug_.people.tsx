import {
  Link,
  createFileRoute,
  notFound,
  redirect,
} from "@tanstack/react-router";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { BreadcrumbLink, Breadcrumbs } from "../components/breadcrumbs";
import { RouteErrorView, RoutePending } from "../components/route-boundaries";
import { TabLink, Tabs } from "../components/tabs";
import { getEventDetail } from "../features/event-slice/event.functions";
import {
  eventPeopleInput,
  validateEventPeopleSearch,
  type EventPeopleSearch,
  type EventRSVPListResponse,
  type PeopleListResult,
} from "../features/people-slice/contracts";
import { getEventAttendees } from "../features/people-slice/people.functions";
import {
  PeoplePagination,
  PeopleResults,
} from "../features/people-slice/people-views";
import {
  peopleHead,
  unavailablePeopleHead,
} from "../features/people-slice/presentation";
import peopleCSS from "../features/people-slice/people.css?url";

type EventPeopleRouteData = {
  event: { slug: string; title: string };
  response: EventRSVPListResponse;
  people: PeopleListResult;
  publicOrigin: string;
};

const responseTabs = [
  { response: "yes", label: "Going" },
  { response: "maybe", label: "Maybe" },
] as const;

export const Route = createFileRoute("/events/$slug_/people")({
  validateSearch: validateEventPeopleSearch,
  loaderDeps: ({ search }) => eventPeopleInput(search),
  loader: async ({
    context,
    deps,
    location,
    params,
  }): Promise<EventPeopleRouteData> => {
    // The attendees read runs first: it is what tells a visitor to log in and a
    // locked private event to look missing. The detail read supplies the title
    // and, like the event page, runs last because of its cache policy.
    const people = await getEventAttendees({
      data: { slug: params.slug, ...deps },
    });
    if (people.status === "signed_out") {
      throw redirect({ to: "/login", search: { next: location.href } });
    }
    if (people.status === "not_found") {
      throw notFound();
    }

    const detail = await getEventDetail({ data: { slug: params.slug } });
    if (detail.status === "not_found") {
      throw notFound();
    }
    if (detail.status !== "found") {
      throw new Error("Event detail is unavailable");
    }
    if ("locked" in detail.event) {
      throw notFound();
    }

    return {
      event: { slug: detail.event.slug, title: detail.event.title },
      response: deps.response,
      people,
      publicOrigin: context.publicOrigin,
    };
  },
  staleTime: 0,
  headers: () => ({ "cache-control": "private, no-store", vary: "Cookie" }),
  head: ({ loaderData }) => {
    if (!loaderData) return unavailablePeopleHead();
    const head = peopleHead({
      title: `Who's going to ${loaderData.event.title}`,
      description: `The people going to ${loaderData.event.title} on Campus Gaming Network.`,
      path: `/events/${encodeURIComponent(loaderData.event.slug)}/people`,
      publicOrigin: loaderData.publicOrigin,
    });
    return {
      ...head,
      links: [...head.links, { rel: "stylesheet", href: peopleCSS }],
    };
  },
  pendingComponent: EventPeoplePending,
  errorComponent: EventPeopleError,
  component: EventPeoplePage,
});

function EventPeoplePage() {
  const { event, people, response } = Route.useLoaderData();
  const list = people.status === "found" ? people.list : undefined;
  const previousSearch =
    list?.has_previous && list.previous_cursor
      ? paginationSearch(response, { before: list.previous_cursor })
      : undefined;
  const nextSearch =
    list?.has_more && list.next_cursor
      ? paginationSearch(response, { after: list.next_cursor })
      : undefined;

  return (
    <main className="people-page">
      <Breadcrumbs
        current={
          responseTabs.find((tab) => tab.response === response)?.label ??
          "Who's going"
        }
      >
        <BreadcrumbLink to="/events">Events</BreadcrumbLink>
        <BreadcrumbLink to="/events/$slug" params={{ slug: event.slug }}>
          {event.title}
        </BreadcrumbLink>
      </Breadcrumbs>
      <header className="people-heading">
        <h1>{`Who's going to ${event.title}`}</h1>
        <p className="lede">
          People who chose to hide themselves are not shown.
        </p>
      </header>

      <div className="people-tabs">
        <Tabs label="RSVP responses">
          {responseTabs.map((tab) => (
            <TabLink
              current={tab.response === response}
              key={tab.response}
              to="/events/$slug/people"
              params={{ slug: event.slug }}
              search={{ response: tab.response }}
            >
              {tab.label}
            </TabLink>
          ))}
        </Tabs>
      </div>

      <PeopleResults
        emptyHeading={
          response === "yes" ? "No one has RSVP'd yet" : "No maybes yet"
        }
        emptyMessage={
          response === "yes"
            ? "People who RSVP yes will show up here."
            : "People who RSVP maybe will show up here."
        }
        result={people}
        unavailableHeading="Attendees are unavailable right now"
      />

      <PeoplePagination
        label="Attendee pages"
        next={
          nextSearch ? (
            <Link
              to="/events/$slug/people"
              params={{ slug: event.slug }}
              search={nextSearch}
            >
              Next
              <ArrowRight aria-hidden="true" size={16} strokeWidth={2} />
            </Link>
          ) : undefined
        }
        previous={
          previousSearch ? (
            <Link
              to="/events/$slug/people"
              params={{ slug: event.slug }}
              search={previousSearch}
            >
              <ArrowLeft aria-hidden="true" size={16} strokeWidth={2} />
              Previous
            </Link>
          ) : undefined
        }
      />
    </main>
  );
}

// Pagination stays on the tab it started from. Going is the default, so its
// links carry no response.
function paginationSearch(
  response: EventRSVPListResponse,
  cursor: Pick<EventPeopleSearch, "after" | "before">,
): EventPeopleSearch {
  return { ...(response === "maybe" ? { response } : {}), ...cursor };
}

function EventPeoplePending() {
  return <RoutePending message="Loading who's going…" />;
}

function EventPeopleError() {
  return (
    <RouteErrorView
      eyebrow="Attendees unavailable"
      heading="We could not load this list."
      description="Please try again in a moment."
      showNavigation={false}
    />
  );
}
