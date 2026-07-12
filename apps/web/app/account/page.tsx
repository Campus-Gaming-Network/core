import Link from "next/link";
import { redirect } from "next/navigation";
import { ProfileForm } from "../../components/profile-form";
import {
  type Event as DashboardEvent,
  eventLifecycleLabel,
  eventRSVPLabel,
  eventTimeRange,
  schoolLocation,
  teamRoleLabel
} from "../../lib/cgn-api";
import {
  currentProfile,
  getDashboardEvents,
  listFollowedSchools,
  listMyTeams
} from "../../lib/server-api";

export default async function AccountPage() {
  const profile = await currentProfile();

  if (!profile) {
    redirect("/login?next=/account");
  }
  const [dashboardEvents, followedSchools, teams] = await Promise.all([
    getDashboardEvents(5).catch(() => ({
      upcoming_rsvps: [],
      followed_school_events: []
    })),
    listFollowedSchools().catch(() => []),
    listMyTeams(10).catch(() => [])
  ]);

  return (
    <main className="narrow">
      <section className="page-heading">
        <p className="eyebrow">Account</p>
        <h1>{profile.name}</h1>
        <p className="lede">
          Your account dashboard for profile details, followed schools, and
          team activity.
        </p>
      </section>

      <section className="summary-strip" aria-label="Account summary">
        <span>
          <strong>Email</strong>
          {profile.email}
        </span>
        <span>
          <strong>Verification</strong>
          {profile.email_verified_at ? "Email verified" : "Email pending"}
        </span>
        <span>
          <strong>Public profile</strong>
          <Link href={`/users/${profile.id}`}>View profile</Link>
        </span>
      </section>

      {!profile.email_verified_at ? (
        <p className="notice error">
          Verify your email to unlock normal authenticated use.
        </p>
      ) : null}

      <section className="section" aria-labelledby="upcoming-rsvps-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Events</p>
            <h2 id="upcoming-rsvps-title">Upcoming RSVPs</h2>
          </div>
          <Link href="/events">Browse events</Link>
        </div>
        <EventList
          empty="You have no upcoming yes or maybe RSVPs."
          events={dashboardEvents.upcoming_rsvps}
          variant="rsvp"
        />
      </section>

      <section className="section" aria-labelledby="followed-school-events-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Following</p>
            <h2 id="followed-school-events-title">Followed-school events</h2>
          </div>
          <Link href="/schools">Manage follows</Link>
        </div>
        <EventList
          empty="No upcoming public events from followed schools yet."
          events={dashboardEvents.followed_school_events}
          variant="followed"
        />
      </section>

      <section className="section" aria-labelledby="followed-schools-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Following</p>
            <h2 id="followed-schools-title">Followed schools</h2>
          </div>
          <Link href="/schools">Find schools</Link>
        </div>
        {followedSchools.length > 0 ? (
          <div className="list">
            {followedSchools.map((school) => (
              <Link
                className="list-item"
                href={`/schools/${school.slug}`}
                key={school.id}
              >
                <span>
                  <strong>{school.name}</strong>
                  <small>{schoolLocation(school)}</small>
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <p className="empty-state">
            You are not following any additional schools yet.
          </p>
        )}
      </section>

      <section className="section" aria-labelledby="team-activity-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Teams</p>
            <h2 id="team-activity-title">Team activity</h2>
          </div>
          <Link href="/teams">Find teams</Link>
        </div>
        {teams.length > 0 ? (
          <div className="list">
            {teams.map((team) => (
              <Link
                className="list-item"
                href={`/teams/${team.slug}`}
                key={team.id}
              >
                <span className="event-card-heading">
                  <strong>{team.name}</strong>
                  <small>
                    {team.viewer_role ? teamRoleLabel(team.viewer_role) : "Member"}
                    {" · "}
                    {team.member_count} member{team.member_count === 1 ? "" : "s"}
                  </small>
                </span>
                <small>{team.games.map((game) => game.name).join(", ")}</small>
                <small>{team.school?.name ?? "Independent team"}</small>
              </Link>
            ))}
          </div>
        ) : (
          <p className="empty-state">
            You have not joined any teams yet. Join with a team password or
            create your first team.
          </p>
        )}
      </section>

      <ProfileForm profile={profile} />
    </main>
  );
}

function EventList({
  empty,
  events,
  variant
}: {
  empty: string;
  events: DashboardEvent[];
  variant: "followed" | "rsvp";
}) {
  if (events.length === 0) {
    return <p className="empty-state">{empty}</p>;
  }

  return (
    <div className="list">
      {events.map((event) => (
        <Link className="list-item" href={`/events/${event.slug}`} key={event.id}>
          <span className="event-card-heading">
            <strong>{event.title}</strong>
            <small>{eventTimeRange(event)}</small>
          </span>
          <small>
            {variant === "rsvp" && event.viewer_rsvp
              ? `RSVP: ${eventRSVPLabel(event.viewer_rsvp)}`
              : eventLifecycleLabel(event.lifecycle)}
          </small>
          <small>
            {event.host_school.name}
            {" · "}
            {event.games.map((game) => game.name).join(", ")}
          </small>
        </Link>
      ))}
    </div>
  );
}
