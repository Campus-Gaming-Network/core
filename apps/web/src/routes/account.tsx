import { Link, createFileRoute, redirect } from "@tanstack/react-router";
import { ButtonLink } from "../components/button-link";
import {
  DirectoryRow,
  directoryRowClassName,
} from "../components/directory-row";
import { getAccountDashboard } from "../features/account-slice/account.functions";
import {
  AccountEventSection,
  AccountTeamList,
} from "../features/account-slice/account-lists";
import { accountHead } from "../features/account-slice/presentation";
import { Avatar } from "../components/avatar";
import { PageHeading } from "../components/page-heading";
import { RouteErrorView, RoutePending } from "../components/route-boundaries";
import { SchoolMark } from "../components/school-mark";
import { StatusLabel } from "../components/status-label";
import { schoolLocation } from "../features/school-slice/presentation";
import accountCSS from "../features/account-slice/account.css?url";
import { SettingsNav } from "../features/account-slice/settings-nav";
import { Surface } from "../components/surface";

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
                  params={{ id: data.profile.public_id }}
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

          <AccountEventSection
            heading="Upcoming RSVPs"
            headingId="upcoming-rsvps-title"
            sectionId="events"
            empty={
              <>
                <p>No plans yet. Find a game night or tournament to go to.</p>
                <ButtonLink to="/events" variant="secondary">
                  Browse events
                </ButtonLink>
              </>
            }
            events={data.dashboardEvents.upcoming_rsvps}
            variant="rsvp"
          />
          <AccountEventSection
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
          <AccountEventSection
            heading="Followed-school events"
            headingId="followed-school-events-title"
            sectionId="following"
            empty={
              <>
                <p>Nothing coming up at the schools you follow yet.</p>
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
                        <SchoolMark
                          logoURL={school.logo_url}
                          name={school.name}
                          size={44}
                          slug={school.slug}
                        />
                      }
                      meta={[schoolLocation(school)]}
                      name={school.name}
                    />
                  </Link>
                ))}
              </div>
            ) : (
              <Surface as="div" variant="empty">
                <p>
                  You are not following any other schools yet. Follow one from
                  its page to see its events here.
                </p>
                <ButtonLink to="/schools" variant="secondary">
                  Find schools
                </ButtonLink>
              </Surface>
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
            <AccountTeamList teams={data.teams} />
          </section>
        </div>
      </div>
    </main>
  );
}

function AccountPending() {
  return <RoutePending message="Loading your account…" />;
}
function AccountError() {
  return (
    <RouteErrorView
      eyebrow="Account unavailable"
      heading="We could not load your account."
    />
  );
}
