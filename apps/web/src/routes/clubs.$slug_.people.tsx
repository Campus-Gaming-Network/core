import {
  Link,
  createFileRoute,
  notFound,
  redirect,
} from "@tanstack/react-router";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { BreadcrumbLink, Breadcrumbs } from "../components/breadcrumbs";
import { RouteErrorView, RoutePending } from "../components/route-boundaries";
import {
  validatePeopleSearch,
  type PeopleListResult,
  type PeopleSearch,
} from "../features/people-slice/contracts";
import { getClubMembers } from "../features/people-slice/people.functions";
import {
  PeoplePagination,
  PeopleResults,
} from "../features/people-slice/people-views";
import peopleCSS from "../features/people-slice/people.css?url";
import {
  peopleHead,
  unavailablePeopleHead,
} from "../features/people-slice/presentation";
import { getClubDetail } from "../features/club-slice/club.functions";

type ClubPeopleRouteData = {
  club: { slug: string; name: string };
  people: PeopleListResult;
  publicOrigin: string;
};

export const Route = createFileRoute("/clubs/$slug_/people")({
  validateSearch: validatePeopleSearch,
  loaderDeps: ({ search }) => search,
  loader: async ({
    context,
    deps,
    location,
    params,
  }): Promise<ClubPeopleRouteData> => {
    // The members result is checked first: it is what tells a visitor to log
    // in.
    const [people, detail] = await Promise.all([
      getClubMembers({ data: { slug: params.slug, ...deps } }),
      getClubDetail({ data: { slug: params.slug } }),
    ]);
    if (people.status === "signed_out") {
      throw redirect({ to: "/login", search: { next: location.href } });
    }
    if (people.status === "not_found") {
      throw notFound();
    }

    if (detail.status === "not_found") {
      throw notFound();
    }
    if (detail.status !== "found") {
      throw new Error("Club detail is unavailable");
    }

    return {
      club: { slug: detail.club.slug, name: detail.club.name },
      people,
      publicOrigin: context.publicOrigin,
    };
  },
  staleTime: 0,
  headers: () => ({ "cache-control": "private, no-store", vary: "Cookie" }),
  head: ({ loaderData }) => {
    if (!loaderData) return unavailablePeopleHead();
    const head = peopleHead({
      title: `People in ${loaderData.club.name}`,
      description: `The people who joined ${loaderData.club.name} on Campus Gaming Network.`,
      path: `/clubs/${encodeURIComponent(loaderData.club.slug)}/people`,
      publicOrigin: loaderData.publicOrigin,
    });
    return {
      ...head,
      links: [...head.links, { rel: "stylesheet", href: peopleCSS }],
    };
  },
  pendingComponent: ClubPeoplePending,
  errorComponent: ClubPeopleError,
  component: ClubPeoplePage,
});

function ClubPeoplePage() {
  const { people, club } = Route.useLoaderData();
  const list = people.status === "found" ? people.list : undefined;
  const previousSearch: PeopleSearch | undefined =
    list?.has_previous && list.previous_cursor
      ? { before: list.previous_cursor }
      : undefined;
  const nextSearch: PeopleSearch | undefined =
    list?.has_more && list.next_cursor
      ? { after: list.next_cursor }
      : undefined;

  return (
    <main className="people-page">
      <Breadcrumbs current="People">
        <BreadcrumbLink to="/clubs">Clubs</BreadcrumbLink>
        <BreadcrumbLink to="/clubs/$slug" params={{ slug: club.slug }}>
          {club.name}
        </BreadcrumbLink>
      </Breadcrumbs>
      <header className="people-heading people-page__heading">
        <span aria-hidden="true" className="team-mark">
          {club.name.slice(0, 1).toUpperCase()}
        </span>
        <div>
          <h1>{`People in ${club.name}`}</h1>
          <p className="lede">
            People who joined on Campus Gaming Network, which is not membership
            in the club itself. People who chose to hide themselves are not
            shown.
          </p>
        </div>
      </header>

      <PeopleResults
        emptyHeading="No one has joined yet"
        emptyMessage="People who join this club on CGN will show up here."
        result={people}
        rows
        unavailableHeading="Members are unavailable right now"
      />

      <PeoplePagination
        label="Member pages"
        next={
          nextSearch ? (
            <Link
              to="/clubs/$slug/people"
              params={{ slug: club.slug }}
              search={nextSearch}
            >
              Next
              <ArrowRight aria-hidden="true" size={16} strokeWidth={2} />
            </Link>
          ) : undefined
        }
        previous={
          previousSearch ? (
            <Link
              to="/clubs/$slug/people"
              params={{ slug: club.slug }}
              search={previousSearch}
            >
              <ArrowLeft aria-hidden="true" size={16} strokeWidth={2} />
              Previous
            </Link>
          ) : undefined
        }
      />
    </main>
  );
}

function ClubPeoplePending() {
  return <RoutePending message="Loading people…" />;
}

function ClubPeopleError() {
  return (
    <RouteErrorView
      eyebrow="Members unavailable"
      heading="We could not load this list."
      description="Please try again in a moment."
      showNavigation={false}
    />
  );
}
