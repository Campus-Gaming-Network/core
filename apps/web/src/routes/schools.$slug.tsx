import {
  Link,
  createFileRoute,
  notFound,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, ArrowUpRight, Check } from "lucide-react";
import type { FormEvent } from "react";
import { ButtonLink } from "../components/button-link";
import { useEnhancedMutation } from "../components/enhanced-mutation";
import { PageNoticeView } from "../components/page-notice-view";
import { RouteErrorView, RoutePending } from "../components/route-boundaries";
import { SchoolLogo } from "../components/school-logo";
import { EventCard } from "../features/event-slice/event-card";
import { getEventsBrowse } from "../features/event-slice/event.functions";
import {
  peoplePreviewSize,
  type PeopleListResult,
} from "../features/people-slice/contracts";
import { getSchoolMembers } from "../features/people-slice/people.functions";
import {
  PeoplePreview,
  PeopleSignedOut,
} from "../features/people-slice/people-views";
import {
  getSchoolCatalog,
  getSchoolViewerState,
} from "../features/school-slice/catalog.functions";
import {
  followSchool,
  unfollowSchool,
} from "../features/school-slice/school-follow.functions";
import {
  validateSchoolSearch,
  type SchoolDTO,
} from "../features/school-slice/contracts";
import {
  schoolDetailNotices,
  schoolHead,
  schoolLocation,
  schoolShortName,
  safeSchoolWebsite,
} from "../features/school-slice/presentation";
import { getTeamsBrowse } from "../features/team-slice/team.functions";

export type SchoolRouteData = {
  school: SchoolDTO;
  viewer: Awaited<ReturnType<typeof getSchoolViewerState>>;
  events: Awaited<ReturnType<typeof getEventsBrowse>>;
  teams: Awaited<ReturnType<typeof getTeamsBrowse>>;
  /** The first home-school members; a visitor's read is a signed-out result. */
  members: PeopleListResult;
  publicOrigin: string;
};

export const Route = createFileRoute("/schools/$slug")({
  validateSearch: validateSchoolSearch,
  loader: async ({ context, params }): Promise<SchoolRouteData> => {
    const catalog = await getSchoolCatalog({ data: { slug: params.slug } });
    if (catalog.status === "not_found") {
      throw notFound();
    }
    if (catalog.status !== "found") {
      throw new Error("School detail is unavailable");
    }
    const school = catalog.school;
    const [viewer, events, teams, members] = await Promise.all([
      getSchoolViewerState({ data: { schoolId: school.id } }),
      getEventsBrowse({ data: { school: school.slug } }),
      getTeamsBrowse({
        data: { game: "", school: school.slug, after: "", before: "" },
      }),
      // A request with no session never reaches the API.
      getSchoolMembers({
        data: { slug: school.slug, limit: peoplePreviewSize },
      }),
    ]);
    return {
      school,
      viewer,
      events,
      teams,
      members,
      publicOrigin: context.publicOrigin,
    };
  },
  staleTime: 0,
  headers: () => ({
    "cache-control": "private, no-store",
    vary: "Cookie",
  }),
  head: ({ loaderData }) =>
    schoolHead(loaderData?.school, loaderData?.publicOrigin),
  pendingComponent: SchoolPending,
  errorComponent: SchoolError,
  component: SchoolPage,
});

function SchoolPage() {
  const { school, viewer, events, teams, members } = Route.useLoaderData();
  const search = Route.useSearch();
  const website = safeSchoolWebsite(school.website_url);
  const tab = search.tab;

  return (
    <main className="detail-page school-community-page">
      <header className="school-profile-header school-community-header">
        <span
          className={`school-directory-mark school-directory-mark--large${school.logo_wide ? " school-directory-mark--wide" : ""}`}
        >
          <span aria-hidden="true">
            {school.name.slice(0, 1).toUpperCase()}
          </span>
          <SchoolLogo
            alt={`${school.name} logo`}
            logoURL={school.logo_url}
            size={64}
          />
        </span>
        <div className="school-community-identity">
          <h1>{school.name}</h1>
          <p className="school-community-facts">
            {[
              schoolShortName(school),
              schoolLocation(school),
              school.is_main_campus ? "Main campus" : "Branch campus",
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <div className="school-community-actions">
          {viewer.authenticated ? (
            viewer.isHomeSchool ? (
              <span className="school-follow-status">
                <Check aria-hidden="true" size={14} strokeWidth={2.25} />
                Your home school
              </span>
            ) : viewer.isFollowing ? (
              <SchoolFollowForm following school={school} />
            ) : (
              <SchoolFollowForm following={false} school={school} />
            )
          ) : (
            <ButtonLink
              variant="secondary"
              to="/login"
              search={{ next: `/schools/${school.slug}` }}
            >
              Follow school
            </ButtonLink>
          )}
          {website ? (
            <a className="link with-arrow" href={website}>
              Visit school website
              <ArrowUpRight aria-hidden="true" size={14} strokeWidth={2.25} />
            </a>
          ) : null}
        </div>
      </header>

      <PageNoticeView
        notice={search.follow ? schoolDetailNotices[search.follow] : undefined}
      />

      {events.eventsUnavailable && teams.teamsUnavailable ? (
        <section
          aria-labelledby="school-unavailable-heading"
          className="action-panel school-community-empty"
        >
          <h2 id="school-unavailable-heading">
            We could not load campus activity
          </h2>
          <p>Please refresh the page or check back in a few minutes.</p>
        </section>
      ) : !events.eventsUnavailable &&
        !teams.teamsUnavailable &&
        events.events.length === 0 &&
        teams.teams.length === 0 ? (
        <section
          aria-labelledby="school-empty-heading"
          className="action-panel school-community-empty"
        >
          <h2 id="school-empty-heading">No activity here yet</h2>
          <p>
            Be the first to bring this campus community together. Publish a
            casual meetup or start a team in a few minutes.
          </p>
          <div className="actions">
            <ButtonLink variant="primary" to="/events/new">
              Create the first event
            </ButtonLink>
            <Link className="link" to="/teams/new">
              Start a team
            </Link>
          </div>
          {!viewer.authenticated ? (
            <p className="school-empty-note">
              Not ready to organize? Log in and follow the school to see new
              activity on your dashboard.
            </p>
          ) : null}
        </section>
      ) : (
        <>
          <nav className="school-community-tabs" aria-label="School sections">
            <Link
              aria-current={tab === undefined ? "page" : undefined}
              to="/schools/$slug"
              params={{ slug: school.slug }}
            >
              Overview
            </Link>
            <Link
              aria-current={tab === "events" ? "page" : undefined}
              to="/schools/$slug"
              params={{ slug: school.slug }}
              search={{ tab: "events" }}
            >
              Events
            </Link>
            <Link
              aria-current={tab === "teams" ? "page" : undefined}
              to="/schools/$slug"
              params={{ slug: school.slug }}
              search={{ tab: "teams" }}
            >
              Teams
            </Link>
          </nav>

          <div
            className={`school-community-content${tab ? " school-community-content--single" : ""}`}
          >
            {tab !== "teams" ? (
              <section
                id="school-events"
                aria-labelledby="school-events-heading"
              >
                <div className="section-heading">
                  <h2 id="school-events-heading">Upcoming events</h2>
                  <Link to="/events" search={{ school: school.slug }}>
                    View all events
                  </Link>
                </div>
                {events.eventsUnavailable ? (
                  <div className="school-inline-empty">
                    <p>
                      Events are unavailable right now. Please check back soon.
                    </p>
                  </div>
                ) : events.events.length > 0 ? (
                  <div className="list">
                    {events.events.slice(0, 4).map((event) => (
                      <EventCard event={event} key={event.id} />
                    ))}
                  </div>
                ) : (
                  <div className="school-inline-empty">
                    <p>No upcoming events yet.</p>
                    <Link className="link with-arrow" to="/events/new">
                      Create the first event
                      <ArrowRight
                        aria-hidden="true"
                        size={14}
                        strokeWidth={2.25}
                      />
                    </Link>
                  </div>
                )}
              </section>
            ) : null}

            {tab !== "events" ? (
              <section id="school-teams" aria-labelledby="school-teams-heading">
                <div className="section-heading">
                  <h2 id="school-teams-heading">Teams</h2>
                  <Link to="/teams" search={{ school: school.slug }}>
                    View all teams
                  </Link>
                </div>
                {teams.teamsUnavailable ? (
                  <div className="school-inline-empty">
                    <p>
                      Teams are unavailable right now. Please check back soon.
                    </p>
                  </div>
                ) : teams.teams.length > 0 ? (
                  <div className="school-team-list">
                    {teams.teams.slice(0, 4).map((team) => (
                      <Link
                        key={team.id}
                        to="/teams/$slug"
                        params={{ slug: team.slug }}
                      >
                        <span aria-hidden="true" className="team-mark">
                          {team.name.slice(0, 1).toUpperCase()}
                        </span>
                        <span>
                          <strong>{team.name}</strong>
                          <small>
                            {team.member_count} member
                            {team.member_count === 1 ? "" : "s"}
                          </small>
                        </span>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <div className="school-inline-empty">
                    <p>No teams have formed yet.</p>
                    <Link className="link with-arrow" to="/teams/new">
                      Start a team
                      <ArrowRight
                        aria-hidden="true"
                        size={14}
                        strokeWidth={2.25}
                      />
                    </Link>
                  </div>
                )}
              </section>
            ) : null}
          </div>
        </>
      )}

      <section
        aria-labelledby="school-people-heading"
        className="school-people"
        id="school-people"
      >
        <div className="section-heading">
          <h2 id="school-people-heading">People</h2>
          {viewer.authenticated &&
          members.status === "found" &&
          members.list.people.length > 0 ? (
            <Link to="/schools/$slug/people" params={{ slug: school.slug }}>
              See everyone
            </Link>
          ) : null}
        </div>
        {viewer.authenticated ? (
          <PeoplePreview empty="No members yet." result={members} />
        ) : (
          <PeopleSignedOut
            message="Log in to see the people at this school."
            next={`/schools/${school.slug}`}
          />
        )}
      </section>

      {school.logo_attribution ? (
        <p className="school-logo-credit">
          Logo: {school.logo_attribution.author}
          {school.logo_attribution.credit
            ? ` · ${school.logo_attribution.credit}`
            : ""}
          {" · "}
          <a href={school.logo_attribution.source_url}>Source</a>
          {" · "}
          <a href={school.logo_attribution.license_url}>
            {school.logo_attribution.license}
          </a>
          {" · "}
          <a href="/school-logos/credits.html">All school logo credits</a>
        </p>
      ) : null}
    </main>
  );
}

function SchoolFollowForm({
  following,
  school,
}: {
  following: boolean;
  school: Pick<SchoolDTO, "id" | "slug">;
}) {
  const runFollowSchool = useServerFn(followSchool);
  const runUnfollowSchool = useServerFn(unfollowSchool);
  const mutation = useEnhancedMutation(
    "We could not update this school follow. Please try again.",
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = { school_id: school.id, slug: school.slug };
    await mutation.execute(() =>
      following
        ? runUnfollowSchool({ data: input })
        : runFollowSchool({ data: input }),
    );
  }

  const action = following ? unfollowSchool.url : followSchool.url;
  return (
    <form action={action} method="post" onSubmit={submit}>
      <input name="school_id" type="hidden" value={school.id} />
      <input name="slug" type="hidden" value={school.slug} />
      {mutation.message ? (
        <p role="alert" aria-live="polite">
          {mutation.message}
        </p>
      ) : null}
      <button
        className={following ? "button button--secondary" : undefined}
        disabled={mutation.pending}
        type="submit"
      >
        {mutation.pending
          ? following
            ? "Unfollowing…"
            : "Following…"
          : following
            ? "Unfollow"
            : "Follow school"}
      </button>
    </form>
  );
}

function SchoolPending() {
  return <RoutePending message="Loading school…" />;
}

function SchoolError({ reset }: ErrorComponentProps) {
  return (
    <RouteErrorView
      reset={reset}
      eyebrow="School unavailable"
      heading="We could not load this school."
    />
  );
}
