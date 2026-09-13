import {
  Link,
  createFileRoute,
  notFound,
  redirect,
  type ErrorComponentProps
} from "@tanstack/react-router";
import { RouteErrorView, RoutePending } from "../components/route-boundaries";
import {
  validateNewEventSearch,
  type EditEventPageResult
} from "../features/event-slice/contracts";
import { EventForm } from "../features/event-slice/event-form";
import { getEditEventPage } from "../features/event-slice/event.functions";
import { NoScriptSchoolSearch } from "../features/event-slice/event-school-picker";
import eventCSS from "../features/event-slice/events.css?url";

type EditEventRouteData = Extract<
  EditEventPageResult,
  { status: "ready" | "denied" }
>;

export const Route = createFileRoute("/events/$slug_/edit")({
  validateSearch: validateNewEventSearch,
  loaderDeps: ({ search }) => ({ schoolQuery: search.school_q ?? "" }),
  loader: async ({ deps, params }): Promise<EditEventRouteData> => {
    const result = await getEditEventPage({
      data: { slug: params.slug, schoolQuery: deps.schoolQuery }
    });
    if (result.status === "unauthenticated") {
      throw redirect({
        href: `/login?next=/events/${encodeURIComponent(params.slug)}/edit`,
        statusCode: 307
      });
    }
    if (result.status === "not_found") throw notFound();
    if (result.status === "error") {
      throw new Error("Event editing is unavailable");
    }
    return result;
  },
  headers: () => ({ "cache-control": "private, no-store", vary: "Cookie" }),
  head: () => ({
    meta: [
      { title: "Edit event | Campus Gaming Network" },
      { name: "description", content: "Edit your campus gaming event." },
      { name: "robots", content: "noindex,nofollow" },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "Campus Gaming Network" },
      {
        property: "og:title",
        content: "Edit event | Campus Gaming Network"
      },
      {
        property: "og:description",
        content: "Edit your campus gaming event."
      },
      { name: "twitter:card", content: "summary" },
      {
        name: "twitter:title",
        content: "Edit event | Campus Gaming Network"
      },
      {
        name: "twitter:description",
        content: "Edit your campus gaming event."
      }
    ],
    links: [{ rel: "stylesheet", href: eventCSS }]
  }),
  pendingComponent: EditEventPending,
  errorComponent: EditEventError,
  component: EditEventPage
});

function EditEventPage() {
  const data = Route.useLoaderData();
  const { slug } = Route.useParams();
  const search = Route.useSearch();

  if (data.status === "denied") {
    return (
      <main className="narrow">
        <section className="page-heading">
          <p className="eyebrow">Edit event</p>
          <h1>
            {data.reason === "locked"
              ? "This private event is locked."
              : "You do not have permission to edit this event."}
          </h1>
          <p className="lede">
            {data.reason === "locked"
              ? "Only an event organizer can load private event details for editing."
              : "Only an event organizer can change or cancel it."}
          </p>
        </section>
        <Link className="button button--secondary" to="/events/$slug" params={{ slug }}>
          Back to event
        </Link>
      </main>
    );
  }

  const schoolQuery = search.school_q ?? "";
  return (
    <main className="narrow">
      <section className="page-heading">
        <p className="eyebrow">Edit event</p>
        <h1>{data.event.title}</h1>
        <p className="lede">
          Update the event details. Leave the private password blank to keep the
          current password.
        </p>
      </section>
      {search.event === "failed" ? (
        <p role="alert">We could not update that event. Please try again.</p>
      ) : null}
      <NoScriptSchoolSearch
        action={`/events/${encodeURIComponent(slug)}/edit`}
        query={schoolQuery}
      />
      <EventForm
        event={data.event}
        games={data.games}
        initialSchoolQuery={schoolQuery}
        initialSchoolSearchFailed={data.schoolSearchFailed}
        mode="edit"
        schools={data.schools}
      />
    </main>
  );
}

function EditEventPending() {
  return <RoutePending message="Loading event form…" />;
}

function EditEventError({ reset }: ErrorComponentProps) {
  return (
    <RouteErrorView
      reset={reset}
      eyebrow="Event editing unavailable"
      heading="We could not load this event for editing."
      description="Please try again in a moment."
      showNavigation={false}
    />
  );
}
