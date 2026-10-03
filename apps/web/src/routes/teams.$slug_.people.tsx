import {
  Link,
  createFileRoute,
  notFound,
  redirect,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
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
    // The members read runs first: it is what tells a visitor to log in.
    const people = await getTeamMembers({
      data: { slug: params.slug, ...deps },
    });
    if (people.status === "signed_out") {
      throw redirect({ to: "/login", search: { next: location.href } });
    }
    if (people.status === "not_found") {
      throw notFound();
    }

    const detail = await getTeamDetail({ data: { slug: params.slug } });
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
  head: ({ loaderData }) =>
    loaderData
      ? peopleHead({
          title: `People on ${loaderData.team.name}`,
          description: `The people on ${loaderData.team.name} on Campus Gaming Network.`,
          path: `/teams/${encodeURIComponent(loaderData.team.slug)}/people`,
          publicOrigin: loaderData.publicOrigin,
        })
      : unavailablePeopleHead(),
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
    <main className="browse-page">
      <Link
        className="back-link with-arrow"
        to="/teams/$slug"
        params={{ slug: team.slug }}
      >
        <ArrowLeft aria-hidden="true" size={14} strokeWidth={2.25} />
        Back to team
      </Link>
      <header className="people-heading">
        <h1>{`People on ${team.name}`}</h1>
        <p className="lede">
          People who chose to hide themselves are not shown.
        </p>
      </header>

      <PeopleResults
        emptyHeading="No members yet"
        emptyMessage="People who join this team will show up here."
        result={people}
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
