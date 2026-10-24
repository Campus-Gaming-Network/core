import {
  Link,
  createFileRoute,
  notFound,
  redirect,
} from "@tanstack/react-router";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import {
  peoplePreviewSize,
  type PeopleListResult,
} from "../features/people-slice/contracts";
import { getClubMembers } from "../features/people-slice/people.functions";
import {
  PeoplePreview,
  PeopleSignedOut,
} from "../features/people-slice/people-views";
import { BreadcrumbLink, Breadcrumbs } from "../components/breadcrumbs";
import { DetailHero } from "../components/detail-hero";
import { KeyInformation } from "../components/key-information";
import {
  RecordNotFound,
  RouteErrorView,
  RoutePending,
} from "../components/route-boundaries";
import { ButtonLink } from "../components/button-link";
import { PageNoticeView } from "../components/page-notice-view";
import { StatusLabel } from "../components/status-label";
import { ClubCommandForm } from "../features/club-slice/club-command-form";
import { getClubDetail } from "../features/club-slice/club.functions";
import {
  clubNotices,
  validateClubManageSearch,
  type ClubDTO,
} from "../features/club-slice/contracts";
import {
  clubConfirmedLine,
  clubNeedsConfirmationLabel,
  clubHead,
  clubManagedBy,
  clubTypeLabels,
} from "../features/club-slice/presentation";
import { schoolLocation } from "../features/school-slice/presentation";
import clubCSS from "../features/club-slice/clubs.css?url";

export const Route = createFileRoute("/clubs/$slug")({
  validateSearch: validateClubManageSearch,
  loader: async ({ context, params }) => {
    // The members read is for signed-in viewers; a visitor's answers
    // "signed_out" without reaching the API.
    const [result, members] = await Promise.all([
      getClubDetail({ data: { slug: params.slug } }),
      getClubMembers({ data: { slug: params.slug, limit: peoplePreviewSize } }),
    ]);
    if (result.status === "not_found") throw notFound();
    if (result.status !== "found")
      throw new Error("Club detail is unavailable");
    // A slug from before a rename finds the club; send the visitor to its
    // current address so links and search results settle on one URL.
    if (result.club.slug !== params.slug) {
      throw redirect({
        to: "/clubs/$slug",
        params: { slug: result.club.slug },
        statusCode: 301,
      });
    }
    return { club: result.club, members, publicOrigin: context.publicOrigin };
  },
  staleTime: 0,
  head: ({ loaderData }) => {
    const head = clubHead(loaderData?.club, loaderData?.publicOrigin);
    return {
      ...head,
      links: [...head.links, { rel: "stylesheet", href: clubCSS }],
    };
  },
  pendingComponent: ClubPending,
  errorComponent: ClubError,
  notFoundComponent: () => <RecordNotFound kind="club" />,
  component: ClubPage,
});

function ClubPage() {
  const { club, members } = Route.useLoaderData();
  const search = Route.useSearch();
  const location = schoolLocation(club.school, "");
  const confirmed = clubConfirmedLine(club);

  return (
    <main className="club-page">
      <Breadcrumbs current={club.name}>
        <BreadcrumbLink to="/schools/$slug" params={{ slug: club.school.slug }}>
          {club.school.name}
        </BreadcrumbLink>
      </Breadcrumbs>
      <PageNoticeView
        notice={search.club ? clubNotices[search.club] : undefined}
      />
      <DetailHero initial={club.name} logoURL={club.school.logo_url}>
        <h1>{club.name}</h1>
        <p className="detail-hero__meta">
          {clubTypeLabels[club.type]} at{" "}
          <Link to="/schools/$slug" params={{ slug: club.school.slug }}>
            {club.school.name}
          </Link>
          {location ? ` · ${location}` : null}
        </p>
        {club.games.length > 0 ? (
          <div className="tag-list" aria-label="Games">
            {club.games.map((game) => (
              <StatusLabel key={game.id}>{game.name}</StatusLabel>
            ))}
          </div>
        ) : null}
      </DetailHero>

      <div className="layout-detail">
        <div className="layout-detail__main">
          {club.summary.trim() ? (
            <section aria-labelledby="club-about-title">
              <h2 id="club-about-title">About</h2>
              <p className="club-text">{club.summary}</p>
            </section>
          ) : null}
          {club.how_to_join?.trim() ? <HowToJoin club={club} /> : null}
          {!club.summary.trim() && !club.how_to_join?.trim() ? (
            <p className="muted">
              {club.name} has not added a description or how to join yet.
            </p>
          ) : null}
          <ClubPeople club={club} members={members} />
        </div>

        <aside className="layout-detail__aside" aria-label="About this club">
          {club.links.length > 0 ? (
            <section className="detail-card" aria-labelledby="club-links-title">
              <h2 id="club-links-title">Links</h2>
              <ul className="detail-card-body club-links">
                {club.links.map((link) => (
                  <li key={`${link.type}-${link.url}`}>
                    <a
                      className="with-arrow"
                      href={link.url}
                      rel="noopener noreferrer nofollow"
                    >
                      {link.label}
                      <ArrowUpRight
                        aria-hidden="true"
                        size={14}
                        strokeWidth={2.25}
                      />
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <KeyInformation
            title="Club details"
            facts={[
              { term: "Type", value: clubTypeLabels[club.type] },
              { term: "School", value: club.school.name },
              { term: "Page", value: clubManagedBy(club) },
              ...(confirmed
                ? [
                    {
                      term: "Last confirmed",
                      value: club.needs_confirmation ? (
                        <>
                          {confirmed}{" "}
                          <StatusLabel>
                            {clubNeedsConfirmationLabel}
                          </StatusLabel>
                        </>
                      ) : (
                        confirmed
                      ),
                    },
                  ]
                : []),
            ]}
          />
          {members.status === "signed_out" || !club.viewer?.role ? (
            <JoinOnCGN club={club} signedIn={members.status !== "signed_out"} />
          ) : null}
          <ClubViewerActions club={club} />
          {club.claimed ? null : (
            <p className="club-claim">
              Run this club?{" "}
              <Link to="/clubs/$slug/claim" params={{ slug: club.slug }}>
                Claim this club
              </Link>{" "}
              to manage its page.
            </p>
          )}
        </aside>
      </div>
    </main>
  );
}

/**
 * What a signed-in person in the club can do here: officers manage it, an
 * offered member answers the offer, and anyone in it can leave.
 */
function ClubViewerActions({ club }: { club: ClubDTO }) {
  const role = club.viewer?.role;
  if (!role && !club.viewer?.ownership_offered) return null;
  return (
    <section className="detail-card" aria-labelledby="club-you-title">
      <h2 id="club-you-title">You and this club</h2>
      <div className="detail-card-body form-stack">
        {role ? <p>You are {roleLabels[role]} of this club.</p> : null}
        {role === "owner" || role === "editor" ? (
          <ButtonLink
            params={{ slug: club.slug }}
            to="/clubs/$slug/manage"
            variant="primary"
          >
            Manage club
          </ButtonLink>
        ) : null}
        {club.viewer?.ownership_offered ? (
          <>
            <p>
              An owner offered to make you this club&apos;s owner. If you
              accept, they become an editor.
            </p>
            <ClubCommandForm
              command="accept-offer"
              page="club"
              slug={club.slug}
              submitLabel="Accept ownership"
            />
            <ClubCommandForm
              command="cancel-offer"
              page="club"
              slug={club.slug}
              submitLabel="Decline"
              variant="secondary"
            />
          </>
        ) : null}
        {role ? (
          <ClubCommandForm
            command="leave"
            page="club"
            slug={club.slug}
            submitLabel="Leave club"
            pendingLabel="Leaving…"
            variant="secondary"
          />
        ) : null}
      </div>
    </section>
  );
}

/**
 * Joining on CGN lists a person on the club's page here. It is not membership
 * in the club itself, and the card says so beside the button.
 */
function JoinOnCGN({ club, signedIn }: { club: ClubDTO; signedIn: boolean }) {
  const note = (
    <p className="club-join-note">
      Joining lists you on Campus Gaming Network. It does not make you a member
      of the club itself
      {club.how_to_join?.trim() ? (
        <>
          ; for that, see <a href="#club-join-title">How to join</a>.
        </>
      ) : (
        "; the club decides that."
      )}
    </p>
  );
  return (
    <section className="detail-card" aria-labelledby="club-join-cgn-title">
      <h2 id="club-join-cgn-title">Join on CGN</h2>
      <div className="detail-card-body form-stack">
        {signedIn ? (
          <ClubCommandForm
            command="join"
            page="club"
            pendingLabel="Joining…"
            slug={club.slug}
            submitLabel="Join on CGN"
          />
        ) : (
          <ButtonLink
            search={{ next: `/clubs/${club.slug}` }}
            to="/login"
            variant="primary"
          >
            Log in to join
          </ButtonLink>
        )}
        {note}
      </div>
    </section>
  );
}

/**
 * The club's people on CGN. Signed-in viewers see who, with roles; visitors
 * see how many.
 */
function ClubPeople({
  club,
  members,
}: {
  club: ClubDTO;
  members: PeopleListResult;
}) {
  const count = `${club.member_count} ${club.member_count === 1 ? "person has" : "people have"} joined ${club.name} on CGN.`;
  if (members.status === "signed_out") {
    return (
      <section aria-labelledby="club-people-title">
        <h2 id="club-people-title">People</h2>
        <PeopleSignedOut
          message={`${count} Log in to see who.`}
          next={`/clubs/${club.slug}`}
        />
      </section>
    );
  }
  return (
    <section className="detail-card" aria-labelledby="club-people-title">
      <h2 id="club-people-title">People</h2>
      <p className="detail-card-body muted">{count}</p>
      <PeoplePreview empty="No one has joined yet." result={members} />
      {members.status === "found" && members.list.people.length > 0 ? (
        <div className="detail-card-body">
          <Link
            aria-label={`See everyone in ${club.name}`}
            className="link with-arrow"
            params={{ slug: club.slug }}
            to="/clubs/$slug/people"
          >
            See everyone
            <ArrowRight aria-hidden="true" size={14} strokeWidth={2.25} />
          </Link>
        </div>
      ) : null}
    </section>
  );
}

const roleLabels = {
  owner: "an owner",
  editor: "an editor",
  member: "a member",
};

/** The club's own process for becoming a member, written by the club or CGN. */
function HowToJoin({ club }: { club: ClubDTO }) {
  return (
    <section aria-labelledby="club-join-title" className="panel club-join">
      <h2 id="club-join-title">How to join</h2>
      <p className="club-text">{club.how_to_join}</p>
    </section>
  );
}

function ClubPending() {
  return <RoutePending message="Loading club…" />;
}

function ClubError() {
  return (
    <RouteErrorView
      eyebrow="Club unavailable"
      heading="We could not load this club."
    />
  );
}
