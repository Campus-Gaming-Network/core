import {
  Link,
  createFileRoute,
  notFound,
  redirect,
} from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import { BreadcrumbLink, Breadcrumbs } from "../components/breadcrumbs";
import { DetailHero } from "../components/detail-hero";
import { KeyInformation } from "../components/key-information";
import {
  RecordNotFound,
  RouteErrorView,
  RoutePending,
} from "../components/route-boundaries";
import { StatusLabel } from "../components/status-label";
import { getClubDetail } from "../features/club-slice/club.functions";
import type { ClubDTO } from "../features/club-slice/contracts";
import {
  clubConfirmedLine,
  clubHead,
  clubManagedBy,
  clubTypeLabels,
} from "../features/club-slice/presentation";
import { schoolLocation } from "../features/school-slice/presentation";
import clubCSS from "../features/club-slice/clubs.css?url";

export const Route = createFileRoute("/clubs/$slug")({
  loader: async ({ context, params }) => {
    const result = await getClubDetail({ data: { slug: params.slug } });
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
    return { club: result.club, publicOrigin: context.publicOrigin };
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
  const { club } = Route.useLoaderData();
  const location = schoolLocation(club.school, "");
  const confirmed = clubConfirmedLine(club);

  return (
    <main className="club-page">
      <Breadcrumbs current={club.name}>
        <BreadcrumbLink to="/schools/$slug" params={{ slug: club.school.slug }}>
          {club.school.name}
        </BreadcrumbLink>
      </Breadcrumbs>
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
                ? [{ term: "Last confirmed", value: confirmed }]
                : []),
            ]}
          />
          {club.claimed ? null : (
            <p className="club-claim">
              Run this club?{" "}
              <Link to="/support" search={{ topic: "club" }}>
                Let support know
              </Link>
              ; officers will be able to manage their club&apos;s page soon.
            </p>
          )}
        </aside>
      </div>
    </main>
  );
}

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
