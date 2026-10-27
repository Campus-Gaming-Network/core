import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { BreadcrumbLink, Breadcrumbs } from "../components/breadcrumbs";
import { ButtonLink } from "../components/button-link";
import { PageIntro } from "../components/page-heading";
import { PageNoticeView } from "../components/page-notice-view";
import { pageHead } from "../components/public-page-head";
import { RouteErrorView, RoutePending } from "../components/route-boundaries";
import { Surface } from "../components/surface";
import { getEventViewerSession } from "../features/event-slice/auth.functions";
import type { EventDTO } from "../features/event-slice/contracts";
import { getEventDetail } from "../features/event-slice/event.functions";
import eventCSS from "../features/event-slice/events.css?url";
import {
  settingsNoticeKey,
  settingsNotices,
  type SettingsNotice,
} from "../features/tournament-settings/contracts";
import {
  SettingsForm,
  StatusPanel,
} from "../features/tournament-settings/settings-panel";
import { GenerateBracketForm } from "../features/tournament-bracket/bracket-views";
import {
  bracketNoticeKey,
  bracketNotices,
  type BracketNotice,
} from "../features/tournament-bracket/contracts";

type TournamentSettingsRouteData = {
  event: EventDTO;
  publicOrigin: string;
};

export const Route = createFileRoute("/events/$slug_/tournament")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { settings?: SettingsNotice; bracket?: BracketNotice } => {
    const settings = settingsNoticeKey(search.settings);
    const bracket = bracketNoticeKey(search.bracket);
    return {
      ...(settings ? { settings } : {}),
      ...(bracket ? { bracket } : {}),
    };
  },
  loader: async ({ context, params }): Promise<TournamentSettingsRouteData> => {
    const session = await getEventViewerSession();
    if (session.status !== "authenticated") {
      throw redirect({
        href: `/login?next=/events/${encodeURIComponent(params.slug)}/tournament`,
        statusCode: 307,
      });
    }
    // The detail read runs last because of its private cache policy.
    const detail = await getEventDetail({ data: { slug: params.slug } });
    if (detail.status === "not_found") throw notFound();
    if (detail.status !== "found") {
      throw new Error("Event detail is unavailable");
    }
    if ("locked" in detail.event) throw notFound();
    return { event: detail.event, publicOrigin: context.publicOrigin };
  },
  staleTime: 0,
  headers: () => ({ "cache-control": "private, no-store", vary: "Cookie" }),
  head: ({ loaderData }) => {
    const head = pageHead(loaderData?.publicOrigin, {
      title: loaderData
        ? `Tournament settings for ${loaderData.event.title}`
        : "Tournament settings",
      description: "Set up the tournament on this event.",
      path: loaderData
        ? `/events/${encodeURIComponent(loaderData.event.slug)}/tournament`
        : "/events",
      noIndex: true,
    });
    return {
      ...head,
      links: [...head.links, { rel: "stylesheet", href: eventCSS }],
    };
  },
  pendingComponent: () => (
    <RoutePending message="Loading tournament settings…" />
  ),
  errorComponent: () => (
    <RouteErrorView
      eyebrow="Tournament settings unavailable"
      heading="We could not load this tournament's settings."
      description="Please try again in a moment."
      showNavigation={false}
    />
  ),
  component: TournamentSettingsPage,
});

function denial(
  event: EventDTO,
): { heading: string; detail: string; edit?: boolean } | undefined {
  if (!event.viewer_can_edit) {
    return {
      heading: "You can't change this tournament.",
      detail: "Only the event's organizers can set up its tournament.",
    };
  }
  if (event.cancelled_at) {
    return {
      heading: "This event was cancelled.",
      detail: "A cancelled event's tournament can no longer be changed.",
    };
  }
  if (event.tournament) return undefined;
  if (event.lifecycle === "ended") {
    return {
      heading: "This event has ended.",
      detail: "A tournament can't be added to an event that has ended.",
    };
  }
  if (event.event_type !== "tournament") {
    return {
      heading: "This event isn't a tournament.",
      detail:
        "Set the event's type to Tournament, then come back to set up the tournament.",
      edit: true,
    };
  }
  if (event.games.length === 0) {
    return {
      heading: "Add the game first.",
      detail:
        "A tournament is played in one of the event's games. Add it to the event, then come back.",
      edit: true,
    };
  }
  return undefined;
}

function TournamentSettingsPage() {
  const { event } = Route.useLoaderData();
  const search = Route.useSearch();
  // A bracket refusal comes back here, where the bracket is generated.
  const notice = search.settings
    ? settingsNotices[search.settings]
    : search.bracket
      ? bracketNotices[search.bracket]
      : undefined;
  const blocked = denial(event);
  const tournament = event.tournament;
  const editable =
    !blocked &&
    event.lifecycle !== "ended" &&
    tournament?.status !== "completed" &&
    tournament?.status !== "cancelled";

  return (
    <main className="form-page">
      <Breadcrumbs current="Tournament settings">
        <BreadcrumbLink to="/events">Events</BreadcrumbLink>
        <BreadcrumbLink to="/events/$slug" params={{ slug: event.slug }}>
          {event.title}
        </BreadcrumbLink>
      </Breadcrumbs>
      <div className="form-page__body">
        <PageIntro
          title="Tournament settings"
          lede={
            <>
              The tournament on <strong>{event.title}</strong>. Players register
              on the event page once registration is open.
            </>
          }
        />
        <PageNoticeView notice={notice} />
        {blocked ? (
          <Surface variant="empty">
            <h2>{blocked.heading}</h2>
            <p>{blocked.detail}</p>
            <div className="actions">
              {blocked.edit ? (
                <ButtonLink
                  params={{ slug: event.slug }}
                  to="/events/$slug/edit"
                  variant="primary"
                >
                  Edit event
                </ButtonLink>
              ) : null}
              <ButtonLink
                params={{ slug: event.slug }}
                to="/events/$slug"
                variant="secondary"
              >
                Back to event
              </ButtonLink>
            </div>
          </Surface>
        ) : (
          <>
            {tournament ? (
              <StatusPanel event={event} tournament={tournament} />
            ) : null}
            {tournament?.status === "in_progress" &&
            event.lifecycle !== "ended" ? (
              <GenerateBracketForm slug={event.slug} />
            ) : null}
            {editable ? (
              <SettingsForm event={event} tournament={tournament} />
            ) : null}
          </>
        )}
      </div>
    </main>
  );
}
