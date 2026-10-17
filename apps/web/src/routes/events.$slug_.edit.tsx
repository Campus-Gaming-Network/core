import {
  createFileRoute,
  notFound,
  redirect,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { Breadcrumbs, BreadcrumbLink } from "../components/breadcrumbs";
import { FormSectionNav } from "../components/form-section-nav";
import { ButtonLink } from "../components/button-link";
import { RouteErrorView, RoutePending } from "../components/route-boundaries";
import {
  validateNewEventSearch,
  type EditEventPageResult,
} from "../features/event-slice/contracts";
import {
  EventForm,
  eventFormSections,
} from "../features/event-slice/event-form";
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
      data: { slug: params.slug, schoolQuery: deps.schoolQuery },
    });
    if (result.status === "unauthenticated") {
      throw redirect({
        href: `/login?next=/events/${encodeURIComponent(params.slug)}/edit`,
        statusCode: 307,
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
        content: "Edit event | Campus Gaming Network",
      },
      {
        property: "og:description",
        content: "Edit your campus gaming event.",
      },
      { name: "twitter:card", content: "summary" },
      {
        name: "twitter:title",
        content: "Edit event | Campus Gaming Network",
      },
      {
        name: "twitter:description",
        content: "Edit your campus gaming event.",
      },
    ],
    links: [{ rel: "stylesheet", href: eventCSS }],
  }),
  pendingComponent: EditEventPending,
  errorComponent: EditEventError,
  component: EditEventPage,
});

function EditEventPage() {
  const data = Route.useLoaderData();
  const { slug } = Route.useParams();
  const search = Route.useSearch();

  if (data.status === "denied") {
    return (
      <main className="prose">
        <section className="empty-state">
          <p className="eyebrow">Edit event</p>
          <h1>
            {data.reason === "locked"
              ? "This private event is locked."
              : "You do not have permission to edit this event."}
          </h1>
          <p>
            {data.reason === "locked"
              ? "Only an event organizer can load private event details for editing."
              : "Only an event organizer can change or cancel it."}
          </p>
          <div className="actions">
            <ButtonLink
              variant="secondary"
              to="/events/$slug"
              params={{ slug }}
            >
              Back to event
            </ButtonLink>
          </div>
        </section>
      </main>
    );
  }

  const schoolQuery = search.school_q ?? "";
  return (
    <main className="form-page">
      <Breadcrumbs current="Edit">
        <BreadcrumbLink to="/events">Events</BreadcrumbLink>
        <BreadcrumbLink to="/events/$slug" params={{ slug }}>
          {data.event.title}
        </BreadcrumbLink>
      </Breadcrumbs>
      <div className="form-page__layout">
        <FormSectionNav heading="Edit event" sections={eventFormSections} />
        <div className="form-page__body">
          <section className="page-heading">
            <div>
              <h1>Edit event</h1>
              <p className="lede">
                Editing <strong>{data.event.title}</strong>. Changes are saved
                to this event only; its repeat settings cannot be changed.
                {data.event.visibility === "private"
                  ? " Leave the private password blank to keep the current one."
                  : ""}
              </p>
            </div>
          </section>
          {search.event === "failed" ? (
            <p role="alert">
              We could not update that event. Please try again.
            </p>
          ) : null}
          <NoScriptSchoolSearch
            action={`/events/${encodeURIComponent(slug)}/edit`}
            query={schoolQuery}
          />
          <EventForm
            event={data.event}
            games={data.games}
            hostTeams={data.hostTeams}
            initialSchoolQuery={schoolQuery}
            initialSchoolSearchFailed={data.schoolSearchFailed}
            mode="edit"
            schools={data.schools}
          />
        </div>
      </div>
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
