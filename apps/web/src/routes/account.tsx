import {
  Link,
  createFileRoute,
  redirect,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { Users } from "lucide-react";
import type { ReactNode } from "react";
import { ButtonLink } from "../components/button-link";
import { CalendarDate } from "../components/calendar-date";
import { EventRelativeDay } from "../features/event-slice/event-relative-day";
import {
  DirectoryRow,
  directoryRowClassName,
} from "../components/directory-row";
import { EventCounts } from "../components/event-counts";
import { getAccountDashboard } from "../features/account-slice/account.functions";
import { accountHead } from "../features/account-slice/presentation";
import {
  type DashboardEventDTO,
  dashboardEventLimit,
} from "../features/account-slice/contracts";
import { Avatar } from "../components/avatar";
import { PageHeading } from "../components/page-heading";
import { RouteErrorView, RoutePending } from "../components/route-boundaries";
import { SchoolLogo } from "../components/school-logo";
import { StatusLabel } from "../components/status-label";
import {
  eventLifecycleLabel,
  eventRSVPLabel,
  eventTimeRange,
} from "../features/event-slice/presentation";
import { schoolLocation } from "../features/school-slice/presentation";
import { teamRoleLabel } from "../features/team-slice/presentation";
import accountCSS from "../features/account-slice/account.css?url";
import { SettingsNav } from "../features/account-slice/settings-nav";

// The dashboard shows this many rows of each event list.
const dashboardPreviewCount = 3;

export const Route = createFileRoute("/account")({
  loader: async ({ context }) => {
    const dashboard = await getAccountDashboard();
    if (dashboard.status === "unauthenticated") {
      throw redirect({ to: "/login", search: { next: "/account" } });
    }
    if (dashboard.status !== "found") {
      throw new Error("Account details are unavailable");
    }
    return { ...dashboard, publicOrigin: context.publicOrigin };
  },
  staleTime: 0,
  headers: () => ({ "cache-control": "private, no-store", vary: "Cookie" }),
  head: ({ loaderData }) => ({
    ...accountHead(loaderData?.publicOrigin),
    links: [{ rel: "stylesheet", href: accountCSS }],
  }),
  pendingComponent: AccountPending,
  errorComponent: AccountError,
  component: AccountPage,
});

function AccountPage() {
  const data = Route.useLoaderData();
  const emailVerified = Boolean(data.profile.email_verified_at);

  return (
    <main className="settings-page account-page">
      <div className="settings-layout">
        <SettingsNav />
        <div className="settings-body">
          <PageHeading
            actions={
              <>
                <ButtonLink to="/settings/profile" variant="secondary">
                  Edit profile
                </ButtonLink>
                <Link
                  className="link"
                  to="/users/$id"
                  params={{ id: data.profile.id }}
                >
                  View public profile
                </Link>
              </>
            }
            identity={<Avatar id={data.profile.id} name={data.profile.name} />}
            supporting={data.profile.email}
            tags={
              emailVerified ? (
                <StatusLabel tone="success">Email verified</StatusLabel>
              ) : (
                <StatusLabel tone="warning">Email pending</StatusLabel>
              )
            }
            title={data.profile.name}
          />

          {!emailVerified ? (
            <p role="alert">
              Verify your email to unlock normal authenticated use.
            </p>
          ) : null}

          <nav className="account-nav" aria-label="Account sections">
            <span>On this page:</span>
            <ul>
              <li>
                <a href="#events">Upcoming RSVPs</a>
              </li>
              <li>
                <a href="#interested">Interested</a>
              </li>
              <li>
                <a href="#following">Followed-school events</a>
              </li>
              <li>
                <a href="#followed-schools">Followed schools</a>
              </li>
              <li>
                <a href="#teams">Team activity</a>
              </li>
            </ul>
          </nav>

          <DashboardEventSection
            heading="Upcoming RSVPs"
            headingId="upcoming-rsvps-title"
            sectionId="events"
            empty={
              <>
                <p>You have no upcoming yes or maybe RSVPs.</p>
                <ButtonLink to="/events" variant="secondary">
                  Browse events
                </ButtonLink>
              </>
            }
            events={data.dashboardEvents.upcoming_rsvps}
            variant="rsvp"
          />
          <DashboardEventSection
            heading="Interested"
            headingId="interested-events-title"
            sectionId="interested"
            empty={
              <>
                <p>
                  Events you mark “I'm interested” show here, soonest first.
                </p>
                <ButtonLink to="/events" variant="secondary">
                  Browse events
                </ButtonLink>
              </>
            }
            events={data.dashboardEvents.interested_events}
            showAll
            variant="interested"
          />
          <DashboardEventSection
            heading="Followed-school events"
            headingId="followed-school-events-title"
            sectionId="following"
            empty={
              <>
                <p>No upcoming public events from followed schools yet.</p>
                <ButtonLink to="/schools" variant="secondary">
                  Find schools to follow
                </ButtonLink>
              </>
            }
            events={data.dashboardEvents.followed_school_events}
            variant="followed"
          />

          <section
            className="section"
            id="followed-schools"
            aria-labelledby="followed-schools-title"
          >
            <div className="section-heading">
              <h2 id="followed-schools-title">Followed schools</h2>
              <Link className="link" to="/schools">
                Find schools
              </Link>
            </div>
            {data.followedSchools.length > 0 ? (
              <div className="list list--panel">
                {data.followedSchools.map((school) => (
                  <Link
                    className={directoryRowClassName}
                    key={school.id}
                    to="/schools/$slug"
                    params={{ slug: school.slug }}
                  >
                    <DirectoryRow
                      action="View school"
                      identity={
                        <span
                          aria-hidden="true"
                          className="school-directory-mark"
                        >
                          {school.name.slice(0, 1).toUpperCase()}
                          <SchoolLogo logoURL={school.logo_url} size={44} />
                        </span>
                      }
                      meta={[schoolLocation(school)]}
                      name={school.name}
                    />
                  </Link>
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <p>You are not following any additional schools yet.</p>
                <ButtonLink to="/schools" variant="secondary">
                  Find schools
                </ButtonLink>
              </div>
            )}
          </section>

          <section
            className="section"
            id="teams"
            aria-labelledby="team-activity-title"
          >
            <div className="section-heading">
              <h2 id="team-activity-title">Team activity</h2>
              <Link className="link" to="/teams">
                Find teams
              </Link>
            </div>
            {data.teams.length > 0 ? (
              <div className="list list--panel">
                {data.teams.map((team) => (
                  <Link
                    className={directoryRowClassName}
                    key={team.id}
                    to="/teams/$slug"
                    params={{ slug: team.slug }}
                  >
                    <DirectoryRow
                      action="View team"
                      counts={
                        <small className="directory-row__count">
                          <Users
                            aria-hidden="true"
                            size={14}
                            strokeWidth={1.75}
                          />
                          {team.member_count} member
                          {team.member_count === 1 ? "" : "s"}
                        </small>
                      }
                      detail={
                        team.viewer_role
                          ? teamRoleLabel(team.viewer_role)
                          : "Member"
                      }
                      identity={
                        <span aria-hidden="true" className="team-mark">
                          {team.name.slice(0, 1).toUpperCase()}
                        </span>
                      }
                      meta={[team.school?.name ?? "Independent team"]}
                      name={team.name}
                      tags={team.games.map((game) => game.name)}
                    />
                  </Link>
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <p>
                  You have not joined any teams yet. Join with a team password
                  or create your first team.
                </p>
                <ButtonLink to="/teams" variant="secondary">
                  Find teams
                </ButtonLink>
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}

function DashboardEventSection({
  heading,
  headingId,
  sectionId,
  empty,
  events,
  showAll = false,
  variant,
}: {
  heading: string;
  headingId: string;
  sectionId: string;
  empty: ReactNode;
  events: DashboardEventDTO[];
  /** List every event read, not a short preview. */
  showAll?: boolean;
  variant: "followed" | "interested" | "rsvp";
}) {
  const shown = showAll ? events : events.slice(0, dashboardPreviewCount);
  // The API cuts each list off at its limit, so a full list may be longer.
  const total =
    events.length >= dashboardEventLimit
      ? `${events.length}+`
      : String(events.length);

  return (
    <section className="section" id={sectionId} aria-labelledby={headingId}>
      <div className="section-heading">
        <h2 id={headingId}>{heading}</h2>
      </div>
      {events.length > 0 ? (
        <>
          <div className="list list--panel">
            {shown.map((event) => (
              <Link
                className={directoryRowClassName}
                key={event.id}
                to="/events/$slug"
                params={{ slug: event.slug }}
              >
                <DirectoryRow
                  action="View event"
                  counts={
                    <EventCounts
                      going={event.rsvp_yes_count}
                      interested={event.interest_count}
                    />
                  }
                  detail={eventTimeRange(event)}
                  identity={
                    <CalendarDate
                      decorative
                      startsAt={event.starts_at}
                      timezone={event.timezone}
                    />
                  }
                  meta={[event.host_school.name]}
                  name={event.title}
                  status={
                    <>
                      {event.lifecycle === "upcoming" ? null : (
                        <StatusLabel status={event.lifecycle}>
                          {eventLifecycleLabel(event.lifecycle)}
                        </StatusLabel>
                      )}
                      <EventRelativeDay event={event} />
                      {variant === "rsvp" && event.viewer_rsvp ? (
                        <StatusLabel tone="success">
                          {eventRSVPLabel(event.viewer_rsvp)}
                        </StatusLabel>
                      ) : null}
                    </>
                  }
                  tags={event.games.map((game) => game.name)}
                />
              </Link>
            ))}
          </div>
          {events.length > shown.length ? (
            <p className="account-more">
              <span>
                Showing {shown.length} of {total}
              </span>
              <Link className="link" to="/events">
                See all events
              </Link>
            </p>
          ) : null}
        </>
      ) : (
        <div className="empty-state">{empty}</div>
      )}
    </section>
  );
}

function AccountPending() {
  return <RoutePending message="Loading your account…" />;
}
function AccountError({ reset }: ErrorComponentProps) {
  return (
    <RouteErrorView
      reset={reset}
      eyebrow="Account unavailable"
      heading="We could not load your account."
    />
  );
}
