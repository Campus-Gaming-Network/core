import { createFileRoute, redirect } from "@tanstack/react-router";
import { ButtonLink } from "../components/button-link";
import { PageHeading } from "../components/page-heading";
import { RouteErrorView, RoutePending } from "../components/route-boundaries";
import { getAccountDashboard } from "../features/account-slice/account.functions";
import { AccountEventSection } from "../features/account-slice/account-lists";
import { yourPageHead } from "../features/account-slice/presentation";
import accountCSS from "../features/account-slice/account.css?url";

export const Route = createFileRoute("/account_/events")({
  loader: async ({ context }) => {
    const dashboard = await getAccountDashboard();
    if (dashboard.status === "unauthenticated") {
      throw redirect({ to: "/login", search: { next: "/account/events" } });
    }
    if (dashboard.status !== "found") {
      throw new Error("Your events are unavailable");
    }
    return {
      events: dashboard.dashboardEvents,
      unavailable: dashboard.unavailable.dashboardEvents,
      publicOrigin: context.publicOrigin,
    };
  },
  staleTime: 0,
  headers: () => ({ "cache-control": "private, no-store", vary: "Cookie" }),
  head: ({ loaderData }) => ({
    ...yourPageHead(loaderData?.publicOrigin, "events"),
    links: [{ rel: "stylesheet", href: accountCSS }],
  }),
  pendingComponent: () => <RoutePending message="Loading your events…" />,
  errorComponent: YourEventsError,
  component: YourEventsPage,
});

// The events the viewer is going to, might go to, and is interested in,
// each soonest first. The API sends up to its list limit of each.
function YourEventsPage() {
  const { events, unavailable } = Route.useLoaderData();
  const going = events.upcoming_rsvps.filter(
    (event) => event.viewer_rsvp === "yes",
  );
  const maybe = events.upcoming_rsvps.filter(
    (event) => event.viewer_rsvp === "maybe",
  );
  const browse = (
    <ButtonLink to="/events" variant="secondary">
      Browse events
    </ButtonLink>
  );

  return (
    <main className="account-page your-page">
      <PageHeading
        supporting="Upcoming events you said you are going to, might go to, or are interested in."
        title="Your events"
      />
      {unavailable ? (
        <p role="alert">
          Your events are unavailable right now. Please try again in a moment.
        </p>
      ) : (
        <>
          <AccountEventSection
            empty={
              <>
                <p>No plans yet. Find a game night or tournament to go to.</p>
                {browse}
              </>
            }
            events={going}
            heading="Going"
            headingId="your-going-title"
            moreLink={false}
            sectionId="going"
            showAll
            variant="rsvp"
          />
          <AccountEventSection
            empty={<p>No upcoming events where you answered “Maybe”.</p>}
            events={maybe}
            heading="Maybe"
            headingId="your-maybe-title"
            moreLink={false}
            sectionId="maybe"
            showAll
            variant="rsvp"
          />
          <AccountEventSection
            empty={
              <>
                <p>Events you mark “I'm interested” show here.</p>
                {browse}
              </>
            }
            events={events.interested_events}
            heading="Interested"
            headingId="your-interested-title"
            moreLink={false}
            sectionId="interested"
            showAll
            variant="interested"
          />
        </>
      )}
    </main>
  );
}

function YourEventsError() {
  return (
    <RouteErrorView
      eyebrow="Your events unavailable"
      heading="We could not load your events."
    />
  );
}
