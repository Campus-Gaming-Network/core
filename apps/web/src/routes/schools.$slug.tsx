import {
  Link,
  createFileRoute,
  notFound,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import type { FormEvent } from "react";
import { BreadcrumbLink, Breadcrumbs } from "../components/breadcrumbs";
import { ButtonLink } from "../components/button-link";
import {
  DirectoryRow,
  directoryRowClassName,
} from "../components/directory-row";
import { useEnhancedMutation } from "../components/enhanced-mutation";
import { DetailHero } from "../components/detail-hero";
import { KeyInformation } from "../components/key-information";
import { PageNoticeView } from "../components/page-notice-view";
import {
  RecordNotFound,
  RouteErrorView,
  RoutePending,
} from "../components/route-boundaries";
import { SchoolLogo } from "../components/school-logo";
import { StatusLabel } from "../components/status-label";
import { TabLink, Tabs } from "../components/tabs";
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
import schoolPageCSS from "../features/school-slice/school-page.css?url";

type SchoolRouteData = {
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
  head: ({ loaderData }) => {
    // Without loader data the page is a not-found or error view, which sets
    // its own title and robots.
    if (!loaderData)
      return { links: [{ rel: "stylesheet", href: schoolPageCSS }] };
    const head = schoolHead(loaderData.school, loaderData.publicOrigin);
    return {
      ...head,
      links: [...head.links, { rel: "stylesheet", href: schoolPageCSS }],
    };
  },
  pendingComponent: SchoolPending,
  errorComponent: SchoolError,
  notFoundComponent: () => <RecordNotFound kind="school" />,
  component: SchoolPage,
});

function SchoolPage() {
  const { school, viewer, events, teams, members } = Route.useLoaderData();
  const search = Route.useSearch();
  const website = safeSchoolWebsite(school.website_url);
  const tab = search.tab;
  const location = schoolLocation(school);
  const activityUnavailable =
    events.eventsUnavailable && teams.teamsUnavailable;
  const hasActivity =
    !activityUnavailable &&
    (events.eventsUnavailable ||
      teams.teamsUnavailable ||
      events.events.length > 0 ||
      teams.teams.length > 0);

  return (
    <main className="school-page">
      <Breadcrumbs current={school.name}>
        <BreadcrumbLink to="/schools">Schools</BreadcrumbLink>
      </Breadcrumbs>
      <DetailHero
        actions={
          viewer.authenticated ? (
            viewer.isHomeSchool ? (
              <StatusLabel tone="success">Your home school</StatusLabel>
            ) : viewer.isFollowing ? (
              <SchoolFollowForm following school={school} />
            ) : (
              <SchoolFollowForm following={false} school={school} />
            )
          ) : (
            <ButtonLink
              variant="primary"
              to="/login"
              search={{ next: `/schools/${school.slug}` }}
            >
              Follow school
            </ButtonLink>
          )
        }
        initial={school.name}
        // A wordmark is unreadable in the square tile.
        logoURL={school.logo_wordmark ? undefined : school.logo_url}
      >
        <h1>{school.name}</h1>
        <p className="detail-hero__meta">
          {location}
          {website ? (
            <>
              {location ? " · " : null}
              <a className="with-arrow" href={website}>
                {new URL(website).hostname}
                <ArrowUpRight aria-hidden="true" size={14} strokeWidth={2.25} />
              </a>
            </>
          ) : null}
        </p>
      </DetailHero>

      <PageNoticeView
        notice={search.follow ? schoolDetailNotices[search.follow] : undefined}
      />

      {hasActivity ? (
        <Tabs label="School sections">
          <TabLink
            current={tab === undefined}
            to="/schools/$slug"
            params={{ slug: school.slug }}
          >
            Overview
          </TabLink>
          <TabLink
            current={tab === "events"}
            to="/schools/$slug"
            params={{ slug: school.slug }}
            search={{ tab: "events" }}
          >
            Events
          </TabLink>
          <TabLink
            current={tab === "teams"}
            to="/schools/$slug"
            params={{ slug: school.slug }}
            search={{ tab: "teams" }}
          >
            Teams
          </TabLink>
        </Tabs>
      ) : null}

      <div className="layout-detail">
        <div className="layout-detail__main">
          {activityUnavailable ? (
            <section
              aria-labelledby="school-unavailable-heading"
              className="action-panel"
            >
              <h2 id="school-unavailable-heading">
                We could not load campus activity
              </h2>
              <p>Please refresh the page or check back in a few minutes.</p>
            </section>
          ) : !hasActivity ? (
            <section
              aria-labelledby="school-empty-heading"
              className="action-panel"
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
              {tab !== "teams" ? (
                <section
                  aria-labelledby="school-events-heading"
                  className="panel panel--flush"
                  id="school-events"
                >
                  <div className="panel__header">
                    <h2 id="school-events-heading">Events</h2>
                    <Link to="/events" search={{ school: school.slug }}>
                      View all events
                    </Link>
                  </div>
                  {events.eventsUnavailable ? (
                    <p className="panel__body muted">
                      Events are unavailable right now. Please check back soon.
                    </p>
                  ) : events.events.length > 0 ? (
                    <div className="list directory-list school-page__rows">
                      {events.events.slice(0, 4).map((event) => (
                        <EventCard
                          event={event}
                          key={event.id}
                          showHost={false}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="panel__body school-page__empty">
                      <p className="muted">No public events yet.</p>
                      <Link className="with-arrow" to="/events/new">
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
                <section
                  aria-labelledby="school-teams-heading"
                  className="panel panel--flush"
                  id="school-teams"
                >
                  <div className="panel__header">
                    <h2 id="school-teams-heading">Teams at {school.name}</h2>
                    <Link to="/teams" search={{ school: school.slug }}>
                      View all teams
                    </Link>
                  </div>
                  {teams.teamsUnavailable ? (
                    <p className="panel__body muted">
                      Teams are unavailable right now. Please check back soon.
                    </p>
                  ) : teams.teams.length > 0 ? (
                    <div className="list directory-list school-page__rows">
                      {teams.teams.slice(0, 4).map((team) => (
                        <Link
                          className={directoryRowClassName}
                          key={team.id}
                          to="/teams/$slug"
                          params={{ slug: team.slug }}
                        >
                          <DirectoryRow
                            action="View team"
                            identity={
                              <span aria-hidden="true" className="team-mark">
                                {team.name.slice(0, 1).toUpperCase()}
                              </span>
                            }
                            meta={[
                              `${team.member_count} member${team.member_count === 1 ? "" : "s"}`,
                            ]}
                            name={team.name}
                            tags={team.games.map((game) => game.name)}
                          />
                        </Link>
                      ))}
                    </div>
                  ) : (
                    <div className="panel__body school-page__empty">
                      <p className="muted">No teams have formed yet.</p>
                      <Link className="with-arrow" to="/teams/new">
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
            </>
          )}

          <section
            aria-labelledby="school-people-heading"
            className="panel panel--flush school-page__people"
            id="school-people"
          >
            <div className="panel__header">
              <h2 id="school-people-heading">People</h2>
              {viewer.authenticated &&
              members.status === "found" &&
              members.list.people.length > 0 ? (
                <Link
                  aria-label={`See everyone at ${school.name}`}
                  to="/schools/$slug/people"
                  params={{ slug: school.slug }}
                >
                  See everyone
                </Link>
              ) : null}
            </div>
            {viewer.authenticated ? (
              <PeoplePreview empty="No members yet." result={members} />
            ) : (
              <div className="panel__body">
                <PeopleSignedOut
                  message="Log in to see the people at this school."
                  next={`/schools/${school.slug}`}
                />
              </div>
            )}
          </section>
        </div>

        <aside className="layout-detail__aside" aria-label="About this school">
          {school.logo_wordmark && school.logo_url ? (
            // The square banner tile cannot show a wordmark, so it gets its own
            // wide frame here, where the logo credit below points to it.
            <div className="school-wordmark">
              <SchoolLogo
                alt={`${school.name} logo`}
                eager
                logoURL={school.logo_url}
                size={240}
              />
            </div>
          ) : null}
          <KeyInformation
            title="About"
            facts={[
              ...(schoolShortName(school)
                ? [{ term: "Short name", value: schoolShortName(school) }]
                : []),
              {
                term: "Campus type",
                value: school.is_main_campus ? "Main campus" : "Branch campus",
              },
            ]}
          />
        </aside>
      </div>

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
