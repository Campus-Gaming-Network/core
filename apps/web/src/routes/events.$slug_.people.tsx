import {
  Link,
  createFileRoute,
  notFound,
  redirect,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { RouteErrorView, RoutePending } from "../components/route-boundaries";
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
  head: ({ loaderData }) =>
    loaderData
      ? peopleHead({
          title: `Who's going to ${loaderData.event.title}`,
          description: `The people going to ${loaderData.event.title} on Campus Gaming Network.`,
          path: `/events/${encodeURIComponent(loaderData.event.slug)}/people`,
          publicOrigin: loaderData.publicOrigin,
        })
      : unavailablePeopleHead(),
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
    <main className="browse-page">
      <Link
        className="back-link with-arrow"
        to="/events/$slug"
        params={{ slug: event.slug }}
      >
        <ArrowLeft aria-hidden="true" size={14} strokeWidth={2.25} />
        Back to event
      </Link>
      <header className="people-heading">
        <h1>{`Who's going to ${event.title}`}</h1>
        <p className="lede">
          People who chose to hide themselves are not shown.
        </p>
      </header>

      <nav
        className="school-community-tabs people-tabs"
        aria-label="RSVP responses"
      >
        {responseTabs.map((tab) => (
          <Link
            aria-current={tab.response === response ? "page" : undefined}
            key={tab.response}
            to="/events/$slug/people"
            params={{ slug: event.slug }}
            search={{ response: tab.response }}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

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

function EventPeopleError({ reset }: ErrorComponentProps) {
  return (
    <RouteErrorView
      reset={reset}
      eyebrow="Attendees unavailable"
      heading="We could not load this list."
      description="Please try again in a moment."
      showNavigation={false}
    />
  );
}
