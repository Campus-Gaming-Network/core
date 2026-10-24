import { createFileRoute, redirect } from "@tanstack/react-router";
import { Breadcrumbs, BreadcrumbLink } from "../components/breadcrumbs";
import { FormSectionNav } from "../components/form-section-nav";
import { newIdempotencyKey } from "../components/idempotency-key";
import { RouteErrorView, RoutePending } from "../components/route-boundaries";
import {
  validateNewEventSearch,
  type NewEventPageResult,
} from "../features/event-slice/contracts";
import {
  EventForm,
  eventFormSections,
} from "../features/event-slice/event-form";
import { getNewEventPage } from "../features/event-slice/event.functions";
import { NoScriptSchoolSearch } from "../features/event-slice/event-school-picker";
import eventCSS from "../features/event-slice/events.css?url";

type ReadyNewEvent = Extract<NewEventPageResult, { status: "ready" }> & {
  publicOrigin: string;
  idempotencyKey: string;
};

export const Route = createFileRoute("/events/new")({
  validateSearch: validateNewEventSearch,
  loaderDeps: ({ search }) => ({ schoolQuery: search.school_q ?? "" }),
  loader: async ({ context, deps }): Promise<ReadyNewEvent> => {
    const result = await getNewEventPage({ data: deps });
    if (result.status === "unauthenticated") {
      throw redirect({ href: "/login?next=/events/new", statusCode: 307 });
    }
    if (result.status !== "ready") {
      throw new Error("Event creation is unavailable");
    }
    return {
      ...result,
      publicOrigin: context.publicOrigin,
      idempotencyKey: newIdempotencyKey(),
    };
  },
  headers: () => ({ "cache-control": "private, no-store", vary: "Cookie" }),
  head: ({ loaderData }) => ({
    meta: [
      { title: "Create event | Campus Gaming Network" },
      {
        name: "description",
        content: "Create a new campus gaming event.",
      },
      { name: "robots", content: "noindex,nofollow" },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "Campus Gaming Network" },
      {
        property: "og:title",
        content: "Create event | Campus Gaming Network",
      },
      {
        property: "og:description",
        content: "Create a new campus gaming event.",
      },
      {
        property: "og:url",
        content: `${loaderData?.publicOrigin ?? "http://localhost:3000"}/events/new`,
      },
      { name: "twitter:card", content: "summary" },
      {
        name: "twitter:title",
        content: "Create event | Campus Gaming Network",
      },
      {
        name: "twitter:description",
        content: "Create a new campus gaming event.",
      },
    ],
    links: [{ rel: "stylesheet", href: eventCSS }],
  }),
  pendingComponent: NewEventPending,
  errorComponent: NewEventError,
  component: NewEventPage,
});

function NewEventPage() {
  const data = Route.useLoaderData();
  const search = Route.useSearch();
  const schoolQuery = search.school_q ?? "";

  return (
    <main className="form-page">
      <Breadcrumbs current="Create event">
        <BreadcrumbLink to="/events">Events</BreadcrumbLink>
      </Breadcrumbs>
      <div className="form-page__layout">
        <FormSectionNav heading="Create event" sections={eventFormSections} />
        <div className="form-page__body">
          <section className="page-heading">
            <div>
              <h1>Create event</h1>
              <p className="lede">
                Get people playing together. Start with the basics; you can fill
                in the details after you create it.
              </p>
            </div>
          </section>
          {search.event === "failed" ? (
            <p role="alert">
              We could not create that event. Please try again.
            </p>
          ) : null}
          <NoScriptSchoolSearch action="/events/new" query={schoolQuery} />
          <EventForm
            defaultSchool={data.defaultSchool}
            defaultSchoolID={data.defaultSchoolID}
            defaultTimeZone={data.defaultTimeZone}
            games={data.games}
            hostClubs={data.hostClubs}
            hostTeams={data.hostTeams}
            idempotencyKey={data.idempotencyKey}
            initialSchoolQuery={schoolQuery}
            initialSchoolSearchFailed={data.schoolSearchFailed}
            mode="create"
            schools={data.schools}
          />
        </div>
      </div>
    </main>
  );
}

function NewEventPending() {
  return <RoutePending message="Loading event form…" />;
}

function NewEventError() {
  return (
    <RouteErrorView
      eyebrow="Event creation unavailable"
      heading="We could not load the event form."
      description="Please try again in a moment."
      showNavigation={false}
    />
  );
}
