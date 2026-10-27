import { Link, createFileRoute, notFound } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowRight,
  CalendarDays,
  CalendarPlus,
  ExternalLink,
  Flag,
  Globe,
  Lock,
  Mail,
  MapPin,
  Star,
  Trophy,
  Users,
} from "lucide-react";
import { type FormEvent, useRef, useState } from "react";
import { BreadcrumbLink, Breadcrumbs } from "../components/breadcrumbs";
import { ButtonLink } from "../components/button-link";
import { Callout } from "../components/callout";
import { DetailHero } from "../components/detail-hero";
import { TabLink, Tabs } from "../components/tabs";
import { CopyLink } from "../components/copy-link";
import { ConfirmDialog } from "../components/confirm-dialog";
import {
  FormErrorSummary,
  useEnhancedMutation,
} from "../components/enhanced-mutation";
import { FormField } from "../components/form-field";
import { KeyInformation } from "../components/key-information";
import { PasswordInput } from "../components/password-input";
import {
  newIdempotencyKey,
  useIdempotencyKey,
} from "../components/idempotency-key";
import { pageNoticeKey } from "../components/page-notice";
import { PageNoticeView } from "../components/page-notice-view";
import { Person } from "../components/person";
import {
  RecordNotFound,
  RouteErrorView,
  RoutePending,
} from "../components/route-boundaries";
import { StatusLabel } from "../components/status-label";
import {
  cancelEvent,
  getEventDetail,
  reportEvent,
  setEventInterest,
  unlockEvent,
} from "../features/event-slice/event.functions";
import { getEventViewerSession } from "../features/event-slice/auth.functions";
import { EventTypeTag } from "../features/event-slice/event-facts";
import { EventGameCover } from "../features/event-slice/event-game-cover";
import { EventFacts } from "../features/event-slice/event-facts";
import { useRenderedAt } from "../features/event-slice/event-relative-day";
import { EventTimeText } from "../features/event-slice/event-time-text";
import type {
  EventDTO,
  EventDetailDTO,
  LockedEventDTO,
} from "../features/event-slice/contracts";
import {
  eventDetailNotices,
  eventEndTime,
  eventLifecycleLabel,
  eventTimeRange,
  eventVisibilityLabel,
  formatEventDate,
  recurrenceRuleLabel,
  type EventDetailNotice,
  safeExternalEventUrl,
} from "../features/event-slice/presentation";
import { eventDetailHead } from "../features/event-slice/event-head";
import eventCSS from "../features/event-slice/events.css?url";
import {
  peoplePreviewSize,
  type PeopleListResult,
} from "../features/people-slice/contracts";
import { getEventAttendees } from "../features/people-slice/people.functions";
import {
  PeoplePreview,
  PeopleSignedOut,
} from "../features/people-slice/people-views";
import { verificationDetail } from "../features/people-slice/presentation";
import { schoolMonogram, schoolTone } from "../components/school-identity";
import { formString } from "../components/form-string";
import { getEventActivity } from "../features/event-activity/activity.functions";
import { EventActivityList } from "../features/event-activity/activity-list";
import {
  eventUpdatesPreviewSize,
  type EventActivityEntry,
} from "../features/event-activity/contracts";
import { Button } from "../components/button";
import { RSVPControl } from "../components/rsvp-control";
import { Surface } from "../components/surface";
import {
  EntrantsCard,
  RegistrationPanel,
  RequestsCard,
} from "../features/tournament-registration/registration-panel";
import {
  tournamentNoticeKey,
  type RegistrationTeamDTO,
  type TournamentEntriesResult,
  type TournamentListResult,
  type TournamentNotice,
} from "../features/tournament-registration/contracts";
import {
  getRegistrationTeams,
  getTournamentEntries,
} from "../features/tournament-registration/tournament.functions";
import {
  bracketHost,
  tournamentFormatSummary,
} from "../features/tournament-registration/presentation";
import { TournamentTabs } from "../features/tournament-bracket/bracket-views";
import { getTournamentMatches } from "../features/tournament-bracket/bracket.functions";
import { bracketMayExist } from "../features/tournament-bracket/presentation";

type EventRouteData = {
  event: EventDetailDTO;
  authenticated: boolean;
  /** The first people going, read only for a signed-in viewer of a visible event. */
  attendees?: PeopleListResult;
  entries?: TournamentEntriesResult;
  /** Whether the tournament has a generated bracket, which adds its tab. */
  hasBracket?: boolean;
  registrationTeams?: TournamentListResult<RegistrationTeamDTO>;
  /** The latest log entries the viewer may see; empty when there are none or they could not be read. */
  updates: EventActivityEntry[];
  publicOrigin: string;
  idempotencyKey: string;
};

type EventSearch = {
  event?: EventDetailNotice;
  tournament?: TournamentNotice;
};

export const Route = createFileRoute("/events/$slug")({
  validateSearch: validateEventSearch,
  loader: async ({ context, params }): Promise<EventRouteData> => {
    // Cookie forwarding, upstream validation, and private-event access checks
    // stay behind these server functions. The loader only consumes their safe
    // serializable DTOs.
    // The detail read deliberately runs last because it applies the stricter
    // private cache policy required for unlock-sensitive event responses.
    // Running these server functions concurrently lets their response-header
    // side effects race in the development runtime.
    const session = await getEventViewerSession();
    const detail = await getEventDetail({ data: { slug: params.slug } });

    if (detail.status === "not_found") {
      throw notFound();
    }

    if (detail.status !== "found") {
      throw new Error("Event detail is unavailable");
    }

    if (session.status === "unavailable") {
      throw new Error("Event viewer session is unavailable");
    }

    // Who is going is for signed-in viewers only, and a locked or cancelled
    // event shows nothing. A list that cannot be read is reported in the
    // result and never fails the page.
    const visible = isLockedEvent(detail.event) ? undefined : detail.event;
    const tournament = visible?.tournament;
    // A tournament's entrants take the place of who's going, and an open
    // team tournament needs the viewer's teams for its registration forms.
    const entries = tournament
      ? await getTournamentEntries({ data: { slug: params.slug } })
      : undefined;
    // A bracket exists only once the tournament has started.
    const bracket =
      tournament && bracketMayExist(tournament)
        ? await getTournamentMatches({ data: { slug: params.slug } })
        : undefined;
    const registrationTeams =
      session.authenticated &&
      tournament?.entry_type === "team" &&
      tournament.status === "registration_open" &&
      !tournament.viewer_entry
        ? await getRegistrationTeams({ data: { slug: params.slug } })
        : undefined;
    const attendees =
      session.authenticated && visible && !tournament && !visible.cancelled_at
        ? await getEventAttendees({
            data: {
              slug: params.slug,
              response: "yes",
              limit: peoplePreviewSize,
            },
          })
        : undefined;
    // The latest changes, read after the detail like the attendees. A log
    // that cannot be read leaves the Updates section out.
    const activity = isLockedEvent(detail.event)
      ? undefined
      : await getEventActivity({
          data: { slug: params.slug, limit: eventUpdatesPreviewSize },
        });

    return {
      event: detail.event,
      authenticated: session.authenticated,
      ...(attendees ? { attendees } : {}),
      ...(entries ? { entries } : {}),
      hasBracket: bracket?.status === "ready" && bracket.matches.length > 0,
      ...(registrationTeams ? { registrationTeams } : {}),
      updates: activity?.status === "found" ? activity.page.entries : [],
      publicOrigin: context.publicOrigin,
      idempotencyKey: newIdempotencyKey(),
    };
  },
  headers: () => ({
    "cache-control": "private, no-store",
    vary: "Cookie",
  }),
  // Without loader data the page is a not-found or error view, which sets its
  // own title and robots; adding the private-event head would duplicate them.
  head: ({ loaderData }) =>
    loaderData
      ? eventDetailHead(loaderData, [{ rel: "stylesheet", href: eventCSS }])
      : { links: [{ rel: "stylesheet", href: eventCSS }] },
  pendingComponent: EventPending,
  errorComponent: EventError,
  notFoundComponent: () => <RecordNotFound kind="event" />,
  component: EventPage,
});

function validateEventSearch(search: Record<string, unknown>): EventSearch {
  const event = pageNoticeKey(eventDetailNotices, search.event);
  const tournament = tournamentNoticeKey(search.tournament);
  return {
    ...(event ? { event } : {}),
    ...(tournament ? { tournament } : {}),
  };
}

function EventPage() {
  const {
    attendees,
    entries,
    event,
    authenticated,
    hasBracket,
    publicOrigin,
    registrationTeams,
    updates,
  } = Route.useLoaderData();
  const search = Route.useSearch();

  if (isLockedEvent(event)) {
    return (
      <LockedEventView
        slug={event.slug}
        authenticated={authenticated}
        notice={search.event}
      />
    );
  }

  return (
    <VisibleEventView
      attendees={attendees}
      entries={entries}
      updates={updates}
      event={event}
      authenticated={authenticated}
      hasBracket={Boolean(hasBracket)}
      notice={search.event}
      publicOrigin={publicOrigin}
      registrationTeams={registrationTeams}
      tournamentNotice={search.tournament}
    />
  );
}

function LockedEventView({
  slug,
  authenticated,
  notice,
}: {
  slug: string;
  authenticated: boolean;
  notice?: EventDetailNotice;
}) {
  return (
    <main className="prose">
      <DetailHero tile={<Lock size={36} strokeWidth={2} />}>
        <h1>This event is private.</h1>
        <p className="detail-hero__meta">
          Enter the password the organizer shared with you to see the details.
        </p>
      </DetailHero>
      <Callout icon="lock">
        Nothing private is sent to the browser until the password checks out.
      </Callout>
      <PageNoticeView
        notice={notice ? eventDetailNotices[notice] : undefined}
      />
      <UnlockEventForm slug={slug} />
      <div className="actions">
        <ButtonLink variant="secondary" to="/events">
          Browse public events
        </ButtonLink>
        {authenticated ? null : (
          <ButtonLink
            variant="primary"
            to="/login"
            search={{ next: `/events/${slug}` }}
          >
            Log in
          </ButtonLink>
        )}
      </div>
    </main>
  );
}

function VisibleEventView({
  attendees,
  entries,
  updates,
  event,
  authenticated,
  hasBracket,
  notice,
  publicOrigin,
  registrationTeams,
  tournamentNotice,
}: {
  attendees?: PeopleListResult;
  entries?: TournamentEntriesResult;
  updates: EventActivityEntry[];
  event: EventDTO;
  authenticated: boolean;
  hasBracket: boolean;
  notice?: EventSearch["event"];
  publicOrigin: string;
  registrationTeams?: TournamentListResult<RegistrationTeamDTO>;
  tournamentNotice?: TournamentNotice;
}) {
  const renderedAt = useRenderedAt();
  const paymentURL = safeExternalEventUrl(event.payment_url);
  const onlineURL = safeExternalEventUrl(event.online_url);
  const bracketURL = safeExternalEventUrl(event.tournament?.bracket_url);
  const primaryGame = event.games[0];
  const organizer = event.organizers?.[0];
  const cancelled = Boolean(event.cancelled_at);
  // Registration replaces RSVP on an event with a tournament.
  const tournament = event.tournament;
  const hasPlace = event.format !== "online";
  const directionsURL =
    hasPlace && (event.address || event.location_name)
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
          [event.location_name, event.address].filter(Boolean).join(", "),
        )}`
      : undefined;

  return (
    <main className="event-page">
      <Breadcrumbs current={event.title}>
        <BreadcrumbLink to="/events">Events</BreadcrumbLink>
      </Breadcrumbs>
      {cancelled ? (
        <PageNoticeView
          notice={{
            message:
              "This event was cancelled. RSVPs are closed, and this page comes down a day after the cancellation.",
            severity: "danger",
          }}
        />
      ) : null}
      <DetailHero
        coverURL={
          primaryGame?.has_cover
            ? `/api/games/${encodeURIComponent(primaryGame.slug)}/cover`
            : undefined
        }
        logoURL={event.host_school.logo_url}
        tile={schoolMonogram(event.host_school.name)}
        tone={schoolTone(event.host_school.slug)}
      >
        {/* A running event says so as loudly as the green "Now" band on its
            directory tile, not as one more chip in the tag list. */}
        {event.lifecycle === "happening_now" && !cancelled ? (
          <p className="event-now">
            <span className="event-now__label">Happening now</span>
            <span className="event-now__until">
              Until {eventEndTime(event)}
            </span>
          </p>
        ) : null}
        <h1>{event.title}</h1>
        {/* A team or club hosts; a person only organizes. The school is where
            the event belongs, never its host, since a student's own event is
            not run by their school. */}
        <p className="detail-hero__meta">
          {event.host_team ? (
            <>
              Hosted by{" "}
              <Link to="/teams/$slug" params={{ slug: event.host_team.slug }}>
                {event.host_team.name}
              </Link>
              {" · "}
            </>
          ) : event.host_club ? (
            <>
              Hosted by{" "}
              <Link to="/clubs/$slug" params={{ slug: event.host_club.slug }}>
                {event.host_club.name}
              </Link>
              {" · "}
            </>
          ) : organizer ? (
            <>
              Organized by{" "}
              <Link to="/users/$id" params={{ id: organizer.public_id }}>
                {organizer.name}
              </Link>
              {" · "}
            </>
          ) : null}
          <Link to="/schools/$slug" params={{ slug: event.host_school.slug }}>
            {event.host_school.name}
          </Link>
        </p>
        <div className="tag-list">
          {event.event_type ? <EventTypeTag type={event.event_type} /> : null}
          {cancelled ? (
            <StatusLabel tone="danger">Cancelled</StatusLabel>
          ) : event.lifecycle === "ended" || event.lifecycle === "full" ? (
            <StatusLabel status={event.lifecycle}>
              {eventLifecycleLabel(event.lifecycle)}
            </StatusLabel>
          ) : null}
          <StatusLabel>{eventVisibilityLabel(event.visibility)}</StatusLabel>
          <EventFacts event={{ ...event, event_type: undefined }} />
        </div>
      </DetailHero>
      <div className="event-header">
        {/* When, where, online, and who is going, each said once, with the
            action that goes with it. */}
        <ul className="event-facts" aria-label="When and where">
          <li>
            <CalendarDays aria-hidden="true" size={20} strokeWidth={1.75} />
            <div>
              <strong>
                <time dateTime={event.starts_at}>
                  <EventTimeText range={eventTimeRange(event, renderedAt)} />
                </time>
              </strong>
              <small>{event.timezone.replaceAll("_", " ")}</small>
              {cancelled ? null : (
                <a
                  className="text-action with-arrow"
                  href={`/api/events/${encodeURIComponent(event.slug)}/calendar.ics`}
                >
                  <CalendarPlus
                    aria-hidden="true"
                    size={16}
                    strokeWidth={1.75}
                  />
                  Add to calendar
                </a>
              )}
            </div>
          </li>
          {hasPlace ? (
            <li>
              <MapPin aria-hidden="true" size={20} strokeWidth={1.75} />
              <div>
                <strong>
                  {event.location_name ||
                    event.address ||
                    "Location to be announced"}
                </strong>
                {event.location_name && event.address ? (
                  <small>{event.address}</small>
                ) : null}
                {directionsURL ? (
                  <a className="text-action" href={directionsURL}>
                    Get directions
                  </a>
                ) : null}
              </div>
            </li>
          ) : null}
          {event.format !== "in_person" ? (
            <li>
              <Globe aria-hidden="true" size={20} strokeWidth={1.75} />
              <div>
                <strong>
                  {event.format === "hybrid" ? "Also online" : "Online event"}
                </strong>
                {/* The API sends the meeting link only to people going and
                    to organizers, so its presence decides what shows. */}
                {onlineURL ? (
                  <>
                    <small className="online-url">{onlineURL}</small>
                    <a
                      className="button button--primary button--small calendar-action"
                      href={onlineURL}
                      rel="noopener noreferrer"
                      target="_blank"
                    >
                      Join online
                      <span className="visually-hidden">
                        {" "}
                        (opens in a new tab)
                      </span>
                    </a>
                  </>
                ) : (
                  <small>The link is shared with people who are going.</small>
                )}
              </div>
            </li>
          ) : null}
          {tournament ? (
            <li>
              <Trophy aria-hidden="true" size={20} strokeWidth={1.75} />
              <div>
                <strong>{tournamentFormatSummary(tournament)}</strong>
              </div>
            </li>
          ) : null}
          <li>
            <Users aria-hidden="true" size={20} strokeWidth={1.75} />
            <div>
              <strong>
                {tournament
                  ? tournament.entrant_cap
                    ? `${tournament.entry_count} of ${tournament.entrant_cap} registered`
                    : `${tournament.entry_count} registered`
                  : event.capacity
                    ? `${event.rsvp_yes_count} of ${event.capacity} going`
                    : `${event.rsvp_yes_count} going`}
              </strong>
              {event.interest_count > 0 ? (
                <small>{event.interest_count} interested</small>
              ) : null}
            </div>
          </li>
        </ul>
        {tournament && !cancelled ? (
          <RegistrationPanel
            authenticated={authenticated}
            event={event}
            notice={tournamentNotice}
            renderedAt={renderedAt}
            teams={registrationTeams}
            tournament={tournament}
          >
            {authenticated ? <InterestEventForm event={event} /> : null}
          </RegistrationPanel>
        ) : (
          <section
            className="event-header__rsvp"
            aria-labelledby="event-rsvp-heading"
          >
            <h2 id="event-rsvp-heading">Are you going?</h2>
            {cancelled ? (
              <p className="rsvp-note">
                RSVPs are closed because this event was cancelled.
              </p>
            ) : authenticated ? (
              <>
                <RSVPControl event={event} />
                <InterestEventForm event={event} />
              </>
            ) : (
              <ButtonLink
                variant="primary"
                to="/login"
                search={{ next: `/events/${event.slug}` }}
              >
                Log in to RSVP
              </ButtonLink>
            )}
            {cancelled ? null : (
              <p className="rsvp-help">
                <Mail aria-hidden="true" size={14} strokeWidth={1.75} />
                Answer yes and we will email you a confirmation with a calendar
                file.
              </p>
            )}
          </section>
        )}
      </div>

      {/* A cancelled event has no attendee list to show, and a tournament
          has its own sections instead. */}
      {cancelled ? null : tournament ? (
        <TournamentTabs
          current="overview"
          hasBracket={hasBracket}
          slug={event.slug}
          tournament={tournament}
        />
      ) : (
        <Tabs label="Event sections">
          <TabLink current to="/events/$slug" params={{ slug: event.slug }}>
            Overview
          </TabLink>
          <TabLink
            current={false}
            to="/events/$slug/people"
            params={{ slug: event.slug }}
          >
            {`Going (${event.rsvp_yes_count})`}
          </TabLink>
        </Tabs>
      )}

      <PageNoticeView
        notice={notice ? eventDetailNotices[notice] : undefined}
      />

      <div className="layout-detail">
        <div className="layout-detail__main">
          <section className="event-about" aria-labelledby="event-about-title">
            <h2 id="event-about-title">About this event</h2>
            <p>{event.description || "Event details are coming soon."}</p>
          </section>

          {cancelled ? null : tournament ? (
            <EntrantsCard
              entries={entries ?? { status: "unavailable" }}
              preview={peoplePreviewSize}
              slug={event.slug}
              tournament={tournament}
            />
          ) : authenticated ? (
            <Surface variant="card" aria-labelledby="event-people-title">
              <h2 id="event-people-title">{"Who's going"}</h2>
              <PeoplePreview
                empty="No one has RSVP'd yet."
                result={attendees ?? { status: "unavailable" }}
              />
              <div className="detail-card-body">
                <Link
                  aria-label={`See everyone going to ${event.title}`}
                  className="link with-arrow"
                  to="/events/$slug/people"
                  params={{ slug: event.slug }}
                >
                  See everyone
                  <ArrowRight aria-hidden="true" size={14} strokeWidth={2.25} />
                </Link>
              </div>
            </Surface>
          ) : (
            <PeopleSignedOut
              message="Log in to see who's going."
              next={`/events/${event.slug}`}
            />
          )}

          {!cancelled &&
          tournament?.registration_mode === "approval" &&
          event.viewer_can_edit &&
          entries?.status === "ready" ? (
            <RequestsCard
              canDecide={tournament.status === "registration_open"}
              requests={entries.requests}
              slug={event.slug}
            />
          ) : null}

          {updates.length > 0 ? (
            <Surface variant="card" aria-labelledby="event-updates-title">
              <h2 id="event-updates-title">Updates</h2>
              <div className="detail-card-body">
                <EventActivityList
                  entries={updates}
                  timeZone={event.timezone}
                />
                <Link
                  aria-label={`See every update to ${event.title}`}
                  className="link with-arrow"
                  to="/events/$slug/activity"
                  params={{ slug: event.slug }}
                >
                  See all updates
                  <ArrowRight aria-hidden="true" size={14} strokeWidth={2.25} />
                </Link>
              </div>
            </Surface>
          ) : null}

          {event.organizers && event.organizers.length > 0 ? (
            <section aria-labelledby="event-organizers">
              <h2 id="event-organizers">Organizers</h2>
              <ul className="organizer-list">
                {event.organizers.map((organizer) => (
                  <li key={organizer.id}>
                    <Person
                      detail={verificationDetail(organizer)}
                      id={organizer.id}
                      profileId={organizer.public_id}
                      name={organizer.name}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {authenticated ? (
            <section aria-label="Event safety and management">
              {/* An event that has ended can no longer be changed, except
                  that a tournament in progress can still be completed. */}
              {event.viewer_can_edit &&
              (event.lifecycle !== "ended" ||
                tournament?.status === "in_progress") ? (
                <Surface as="div" variant="panel" className="event-manage">
                  <h2 id="manage-event">Manage event</h2>
                  {event.lifecycle === "ended" ? (
                    <p className="form-help">
                      The event has ended. Mark the tournament complete in its
                      settings.
                    </p>
                  ) : (
                    <p className="form-help">
                      {event.viewer_is_creator
                        ? "You can change the details, manage organizers, or cancel this event."
                        : event.viewer_can_cancel && event.host_club
                          ? `You can change the details or cancel this event as an officer of ${event.host_club.name}.`
                          : "You can change the details of this event as a co-organizer."}
                    </p>
                  )}
                  <div className="actions">
                    {event.lifecycle === "ended" ? null : (
                      <ButtonLink
                        variant="secondary"
                        to="/events/$slug/edit"
                        params={{ slug: event.slug }}
                      >
                        Edit event
                      </ButtonLink>
                    )}
                    {event.event_type === "tournament" || tournament ? (
                      <ButtonLink
                        variant="secondary"
                        to="/events/$slug/tournament"
                        params={{ slug: event.slug }}
                      >
                        {tournament
                          ? "Tournament settings"
                          : "Set up tournament"}
                      </ButtonLink>
                    ) : null}
                    {event.viewer_can_cancel && event.lifecycle !== "ended" ? (
                      <CancelEventForm slug={event.slug} />
                    ) : null}
                  </div>
                </Surface>
              ) : null}
              <details className="safety-details">
                <summary>
                  <Flag aria-hidden="true" size={14} strokeWidth={1.75} />
                  Report this event
                </summary>
                <ReportEventForm slug={event.slug} />
              </details>
            </section>
          ) : null}
        </div>

        <aside className="layout-detail__aside" aria-label="Event info">
          <KeyInformation
            facts={[
              // An event about no game (an informational meeting) has no row.
              ...(event.games.length > 0
                ? [
                    {
                      term: "Games",
                      value: (
                        <ul aria-label="Games" className="event-game-list">
                          {event.games.map((game) => (
                            <li key={game.id}>
                              <EventGameCover
                                hasCover={game.has_cover}
                                slug={game.slug}
                              />
                              <strong>{game.name}</strong>
                            </li>
                          ))}
                        </ul>
                      ),
                    },
                  ]
                : []),
              ...(event.recurrence_rule && event.recurrence_until
                ? [
                    {
                      term: "Repeats",
                      value: `${recurrenceRuleLabel(event.recurrence_rule)} until ${formatEventDate(event.recurrence_until, event.timezone)}`,
                    },
                  ]
                : []),
            ]}
            title="Details"
          />

          {/* A bracket hosted elsewhere is a link out, never embedded. */}
          {bracketURL ? (
            <Surface variant="card" aria-labelledby="event-bracket-title">
              <h2 id="event-bracket-title">Bracket</h2>
              <div className="detail-card-body">
                <a
                  className="link with-arrow"
                  href={bracketURL}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  {`Bracket on ${bracketHost(bracketURL)}`}
                  <ExternalLink
                    aria-hidden="true"
                    size={14}
                    strokeWidth={2.25}
                  />
                  <span className="visually-hidden">
                    {" "}
                    (external site, opens in a new tab)
                  </span>
                </a>
              </div>
            </Surface>
          ) : null}

          <Surface variant="card">
            <h2>Share</h2>
            <CopyLink
              label="Event link"
              shareTitle={event.title}
              url={`${publicOrigin}/events/${encodeURIComponent(event.slug)}`}
            />
          </Surface>

          {event.cost === "paid" ? (
            <Surface variant="card">
              <h2>Payment</h2>
              <div className="detail-card-body">
                <p>{event.payment_note || "Payment happens off CGN."}</p>
                {paymentURL ? <a href={paymentURL}>Open payment link</a> : null}
              </div>
            </Surface>
          ) : null}
        </aside>
      </div>
    </main>
  );
}

function InterestEventForm({ event }: { event: EventDTO }) {
  const runSetEventInterest = useServerFn(setEventInterest);
  const mutation = useEnhancedMutation(
    "We could not update your interest. Please try again.",
  );
  const interested = !event.viewer_interested;

  async function submit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    await mutation.execute(() =>
      runSetEventInterest({ data: { slug: event.slug, interested } }),
    );
  }

  return (
    <form
      action={setEventInterest.url}
      className="interest-form"
      method="post"
      onSubmit={submit}
    >
      <input name="slug" type="hidden" value={event.slug} />
      <input name="interested" type="hidden" value={String(interested)} />
      {mutation.message ? <p role="alert">{mutation.message}</p> : null}
      <button
        className={
          event.viewer_interested ? "interest-toggle is-on" : "interest-toggle"
        }
        disabled={mutation.pending}
        type="submit"
      >
        <Star
          aria-hidden="true"
          fill={event.viewer_interested ? "currentColor" : "none"}
          size={16}
          strokeWidth={1.75}
        />
        {mutation.pending
          ? "Saving interest…"
          : event.viewer_interested
            ? "Remove interested"
            : "I'm interested"}
      </button>
    </form>
  );
}

function CancelEventForm({ slug }: { slug: string }) {
  const runCancelEvent = useServerFn(cancelEvent);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [confirming, setConfirming] = useState(false);
  const mutation = useEnhancedMutation(
    "We could not cancel that event. Please try again.",
  );

  async function submit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    if (!confirming) {
      setConfirming(true);
      return;
    }
    await mutation.execute(() => runCancelEvent({ data: { slug } }));
  }

  return (
    <form action={cancelEvent.url} method="post" onSubmit={submit}>
      <input name="slug" type="hidden" value={slug} />
      <Button
        variant="destructive"
        disabled={mutation.pending}
        ref={triggerRef}
        type="submit"
      >
        Cancel event
      </Button>
      <ConfirmDialog
        cancelLabel="Keep event"
        confirmLabel="Yes, cancel event"
        heading="Cancel this event?"
        onClose={() => setConfirming(false)}
        open={confirming}
        pending={mutation.pending}
        returnFocusRef={triggerRef}
      >
        <p>
          Attendees will no longer be able to RSVP. This action cannot be
          undone.
        </p>
        {mutation.message ? <p role="alert">{mutation.message}</p> : null}
      </ConfirmDialog>
    </form>
  );
}

function ReportEventForm({ slug }: { slug: string }) {
  const runReportEvent = useServerFn(reportEvent);
  const idempotency = useIdempotencyKey(
    Route.useLoaderData({ select: (data) => data.idempotencyKey }),
  );
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [reasonErrors, setReasonErrors] = useState<string[] | undefined>();

  async function submit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    const formElement = formEvent.currentTarget;
    const form = new FormData(formElement);
    setPending(true);
    setMessage("");
    setFailed(false);
    setReasonErrors(undefined);
    try {
      const result = await runReportEvent({
        data: {
          slug,
          reason: formString(form, "reason"),
          idempotency_key: idempotency.key,
        },
      });
      if (result.status === "error") {
        setFailed(true);
        setMessage(
          result.fieldErrors?.reason?.length
            ? result.message
            : "We could not submit that report. Please try again.",
        );
        setReasonErrors(result.fieldErrors?.reason);
      } else {
        setMessage(result.message);
        formElement.reset();
        idempotency.rotate();
      }
    } catch {
      setFailed(true);
      setMessage("We could not submit that report. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      action={reportEvent.url}
      className="form-stack report-form"
      method="post"
      onSubmit={submit}
    >
      <input name="slug" type="hidden" value={slug} />
      <input name="idempotency_key" type="hidden" value={idempotency.key} />
      {message ? (
        <p role={failed ? "alert" : "status"} aria-live="polite">
          {message}
        </p>
      ) : null}
      <FormField
        errorId="event-report-reason-error"
        errors={reasonErrors}
        label="Reason"
      >
        <textarea maxLength={2000} name="reason" required rows={3} />
      </FormField>
      <button disabled={pending} type="submit">
        {pending ? "Submitting…" : "Submit report"}
      </button>
    </form>
  );
}

function UnlockEventForm({ slug }: { slug: string }) {
  const runUnlockEvent = useServerFn(unlockEvent);
  const mutation = useEnhancedMutation(
    "We could not unlock that event. Please try again.",
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

    await mutation.execute(() =>
      runUnlockEvent({
        data: {
          slug,
          password: formString(form, "password"),
        },
      }),
    );
  }

  const passwordErrors = mutation.fieldErrors.password;

  return (
    <form
      action={unlockEvent.url}
      className="inline-form private-unlock-form"
      method="post"
      onSubmit={submit}
    >
      <input type="hidden" name="slug" value={slug} />
      <FormErrorSummary
        fieldErrors={mutation.fieldErrors}
        fieldIds={{ password: "event-password-error" }}
        message={mutation.message}
        summaryRef={mutation.errorSummaryRef}
      />
      <FormField
        errorId="event-password-error"
        errors={passwordErrors}
        label="Event password"
      >
        <PasswordInput
          name="password"
          autoComplete="off"
          required
          minLength={8}
          maxLength={256}
        />
      </FormField>
      <button type="submit" disabled={mutation.pending}>
        {mutation.pending ? "Unlocking…" : "Unlock event"}
      </button>
    </form>
  );
}

function EventPending() {
  return <RoutePending message="Loading event…" />;
}

function EventError() {
  return (
    <RouteErrorView
      eyebrow="Event unavailable"
      heading="We could not load this event."
      description="This is usually temporary. Try again in a moment."
    />
  );
}

function isLockedEvent(event: EventDetailDTO): event is LockedEventDTO {
  return "locked" in event && event.locked === true;
}
