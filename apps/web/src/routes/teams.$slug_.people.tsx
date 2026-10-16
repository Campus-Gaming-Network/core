import {
  Link,
  createFileRoute,
  notFound,
  redirect,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { BreadcrumbLink, Breadcrumbs } from "../components/breadcrumbs";
import { RouteErrorView, RoutePending } from "../components/route-boundaries";
import {
  validatePeopleSearch,
  type PeopleListResult,
  type PeopleSearch,
} from "../features/people-slice/contracts";
import { getTeamMembers } from "../features/people-slice/people.functions";
import {
  PeoplePagination,
  PeopleResults,
} from "../features/people-slice/people-views";
import peopleCSS from "../features/people-slice/people.css?url";
import {
  peopleHead,
  unavailablePeopleHead,
} from "../features/people-slice/presentation";
import { getTeamDetail } from "../features/team-slice/team.functions";

type TeamPeopleRouteData = {
  team: { slug: string; name: string };
  people: PeopleListResult;
  publicOrigin: string;
};

export const Route = createFileRoute("/teams/$slug_/people")({
  validateSearch: validatePeopleSearch,
  loaderDeps: ({ search }) => search,
  loader: async ({
    context,
    deps,
    location,
    params,
  }): Promise<TeamPeopleRouteData> => {
    // The members result is checked first: it is what tells a visitor to log
    // in.
    const [people, detail] = await Promise.all([
      getTeamMembers({ data: { slug: params.slug, ...deps } }),
      getTeamDetail({ data: { slug: params.slug } }),
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
      throw new Error("Team detail is unavailable");
    }

    return {
      team: { slug: detail.team.slug, name: detail.team.name },
      people,
      publicOrigin: context.publicOrigin,
    };
  },
  staleTime: 0,
  headers: () => ({ "cache-control": "private, no-store", vary: "Cookie" }),
  head: ({ loaderData }) => {
    if (!loaderData) return unavailablePeopleHead();
    const head = peopleHead({
      title: `People on ${loaderData.team.name}`,
      description: `The people on ${loaderData.team.name} on Campus Gaming Network.`,
      path: `/teams/${encodeURIComponent(loaderData.team.slug)}/people`,
      publicOrigin: loaderData.publicOrigin,
    });
    return {
      ...head,
      links: [...head.links, { rel: "stylesheet", href: peopleCSS }],
    };
  },
  pendingComponent: TeamPeoplePending,
  errorComponent: TeamPeopleError,
  component: TeamPeoplePage,
});

function TeamPeoplePage() {
  const { people, team } = Route.useLoaderData();
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
      <Breadcrumbs current="Members">
        <BreadcrumbLink to="/teams">Teams</BreadcrumbLink>
        <BreadcrumbLink to="/teams/$slug" params={{ slug: team.slug }}>
          {team.name}
        </BreadcrumbLink>
      </Breadcrumbs>
      <header className="people-heading people-page__heading">
        <span aria-hidden="true" className="team-mark">
          {team.name.slice(0, 1).toUpperCase()}
        </span>
        <div>
          <h1>{`People on ${team.name}`}</h1>
          <p className="lede">
            People who chose to hide themselves are not shown.
          </p>
        </div>
      </header>

      <PeopleResults
        emptyHeading="No members yet"
        emptyMessage="People who join this team will show up here."
        result={people}
        rows
        unavailableHeading="Members are unavailable right now"
      />

      <PeoplePagination
        label="Member pages"
        next={
          nextSearch ? (
            <Link
              to="/teams/$slug/people"
              params={{ slug: team.slug }}
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
              to="/teams/$slug/people"
              params={{ slug: team.slug }}
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

function TeamPeoplePending() {
  return <RoutePending message="Loading people…" />;
}

function TeamPeopleError({ reset }: ErrorComponentProps) {
  return (
    <RouteErrorView
      reset={reset}
      eyebrow="Members unavailable"
      heading="We could not load this list."
      description="Please try again in a moment."
      showNavigation={false}
    />
  );
}
