import { Link } from "@tanstack/react-router";
import { Users } from "lucide-react";
import type { ReactNode } from "react";
import { ButtonLink } from "../../components/button-link";
import { CalendarDate } from "../../components/calendar-date";
import {
  DirectoryRow,
  directoryRowClassName,
} from "../../components/directory-row";
import { EventCounts } from "../../components/event-counts";
import { StatusLabel } from "../../components/status-label";
import {
  eventLifecycleLabel,
  eventRSVPLabel,
  eventRSVPTone,
  eventTimeRange,
} from "../event-slice/presentation";
import { useRenderedAt } from "../event-slice/event-relative-day";
import { teamRoleLabel } from "../team-slice/presentation";
import {
  dashboardEventLimit,
  type AccountTeamDTO,
  type DashboardEventDTO,
} from "./contracts";
import { Surface } from "../../components/surface";

const dashboardPreviewCount = 3;

export function AccountEventSection({
  heading,
  headingId,
  sectionId,
  empty,
  events,
  footer,
  moreLink = true,
  showAll = false,
  variant,
}: {
  heading: string;
  headingId: string;
  sectionId: string;
  empty: ReactNode;
  events: DashboardEventDTO[];
  footer?: ReactNode;
  moreLink?: boolean;
  showAll?: boolean;
  variant: "created" | "followed" | "interested" | "rsvp";
}) {
  const renderedAt = useRenderedAt();
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
                  counts={<EventCounts event={event} />}
                  // The calendar tile shows the date, so the text gives the time.
                  detail={eventTimeRange(event, renderedAt, {
                    startDate: false,
                  })}
                  identity={
                    <CalendarDate
                      inProgress={event.lifecycle === "happening_now"}
                      relativeDay
                      startsAt={event.starts_at}
                      timezone={event.timezone}
                    />
                  }
                  meta={[
                    (event.host_team ?? event.host_club)?.name,
                    event.host_school.name,
                  ]}
                  name={event.title}
                  status={
                    <>
                      {/* Happening now shows on the calendar tile. */}
                      {event.lifecycle === "upcoming" ||
                      event.lifecycle === "happening_now" ? null : (
                        <StatusLabel status={event.lifecycle}>
                          {eventLifecycleLabel(event.lifecycle)}
                        </StatusLabel>
                      )}

                      {variant === "rsvp" && event.viewer_rsvp ? (
                        <StatusLabel tone={eventRSVPTone(event.viewer_rsvp)}>
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
              {moreLink ? (
                <Link className="link" to="/account/events">
                  See all your events
                </Link>
              ) : null}
            </p>
          ) : null}
        </>
      ) : (
        <Surface as="div" variant="empty">
          {empty}
        </Surface>
      )}
      {footer}
    </section>
  );
}

export function AccountTeamList({ teams }: { teams: AccountTeamDTO[] }) {
  return teams.length > 0 ? (
    <div className="list list--panel">
      {teams.map((team) => (
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
                <Users aria-hidden="true" size={14} strokeWidth={1.75} />
                {team.member_count} member
                {team.member_count === 1 ? "" : "s"}
              </small>
            }
            detail={
              team.viewer_role ? teamRoleLabel(team.viewer_role) : "Member"
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
    <Surface as="div" variant="empty">
      <p>No teams yet. Find one that plays your games, or start your own.</p>
      <ButtonLink to="/teams" variant="secondary">
        Find teams
      </ButtonLink>
    </Surface>
  );
}
