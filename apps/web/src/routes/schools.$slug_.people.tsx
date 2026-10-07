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
import { getSchoolMembers } from "../features/people-slice/people.functions";
import {
  PeoplePagination,
  PeopleResults,
} from "../features/people-slice/people-views";
import {
  peopleHead,
  unavailablePeopleHead,
} from "../features/people-slice/presentation";
import { getSchoolCatalog } from "../features/school-slice/catalog.functions";

type SchoolPeopleRouteData = {
  school: { slug: string; name: string };
  people: PeopleListResult;
  publicOrigin: string;
};

export const Route = createFileRoute("/schools/$slug_/people")({
  validateSearch: validatePeopleSearch,
  loaderDeps: ({ search }) => search,
  loader: async ({
    context,
    deps,
    location,
    params,
  }): Promise<SchoolPeopleRouteData> => {
    // The members result is checked first: it is what tells a visitor to log
    // in.
    const [people, catalog] = await Promise.all([
      getSchoolMembers({ data: { slug: params.slug, ...deps } }),
      getSchoolCatalog({ data: { slug: params.slug } }),
    ]);
    if (people.status === "signed_out") {
      throw redirect({ to: "/login", search: { next: location.href } });
    }
    if (people.status === "not_found") {
      throw notFound();
    }

    if (catalog.status === "not_found") {
      throw notFound();
    }
    if (catalog.status !== "found") {
      throw new Error("School detail is unavailable");
    }

    return {
      school: { slug: catalog.school.slug, name: catalog.school.name },
      people,
      publicOrigin: context.publicOrigin,
    };
  },
  staleTime: 0,
  headers: () => ({ "cache-control": "private, no-store", vary: "Cookie" }),
  head: ({ loaderData }) =>
    loaderData
      ? peopleHead({
          title: `People at ${loaderData.school.name}`,
          description: `The people at ${loaderData.school.name} on Campus Gaming Network.`,
          path: `/schools/${encodeURIComponent(loaderData.school.slug)}/people`,
          publicOrigin: loaderData.publicOrigin,
        })
      : unavailablePeopleHead(),
  pendingComponent: SchoolPeoplePending,
  errorComponent: SchoolPeopleError,
  component: SchoolPeoplePage,
});

function SchoolPeoplePage() {
  const { people, school } = Route.useLoaderData();
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
        to="/schools/$slug"
        params={{ slug: school.slug }}
      >
        <ArrowLeft aria-hidden="true" size={14} strokeWidth={2.25} />
        Back to school
      </Link>
      <header className="people-heading">
        <h1>{`People at ${school.name}`}</h1>
        <p className="lede">
          Members who chose this school as their home school. People who chose
          to hide themselves are not shown.
        </p>
      </header>

      <PeopleResults
        emptyHeading="No members yet"
        emptyMessage="People who pick this school as their home school will show up here."
        result={people}
        unavailableHeading="Members are unavailable right now"
      />

      <PeoplePagination
        label="Member pages"
        next={
          nextSearch ? (
            <Link
              to="/schools/$slug/people"
              params={{ slug: school.slug }}
              search={nextSearch}
            >
              Next
            </Link>
          ) : undefined
        }
        previous={
          previousSearch ? (
            <Link
              to="/schools/$slug/people"
              params={{ slug: school.slug }}
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

function SchoolPeoplePending() {
  return <RoutePending message="Loading people…" />;
}

function SchoolPeopleError({ reset }: ErrorComponentProps) {
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
