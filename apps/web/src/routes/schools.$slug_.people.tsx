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
import { getSchoolMembers } from "../features/people-slice/people.functions";
import {
  PeoplePagination,
  PeopleResults,
} from "../features/people-slice/people-views";
import {
  peopleHead,
  unavailablePeopleHead,
} from "../features/people-slice/presentation";
import { SchoolLogo } from "../components/school-logo";
import peopleCSS from "../features/people-slice/people.css?url";
import { getSchoolCatalog } from "../features/school-slice/catalog.functions";

type SchoolPeopleRouteData = {
  school: { slug: string; name: string; logoURL?: string };
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
      school: {
        slug: catalog.school.slug,
        name: catalog.school.name,
        // A wordmark is unreadable at heading height.
        ...(catalog.school.logo_url && !catalog.school.logo_wordmark
          ? { logoURL: catalog.school.logo_url }
          : {}),
      },
      people,
      publicOrigin: context.publicOrigin,
    };
  },
  staleTime: 0,
  headers: () => ({ "cache-control": "private, no-store", vary: "Cookie" }),
  head: ({ loaderData }) => {
    if (!loaderData) return unavailablePeopleHead();
    const head = peopleHead({
      title: `People at ${loaderData.school.name}`,
      description: `The people at ${loaderData.school.name} on Campus Gaming Network.`,
      path: `/schools/${encodeURIComponent(loaderData.school.slug)}/people`,
      publicOrigin: loaderData.publicOrigin,
    });
    return {
      ...head,
      links: [...head.links, { rel: "stylesheet", href: peopleCSS }],
    };
  },
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
    <main className="people-page">
      <Breadcrumbs current="People">
        <BreadcrumbLink to="/schools">Schools</BreadcrumbLink>
        <BreadcrumbLink to="/schools/$slug" params={{ slug: school.slug }}>
          {school.name}
        </BreadcrumbLink>
      </Breadcrumbs>
      <header className="people-heading people-page__heading">
        <span className="school-directory-mark">
          <span aria-hidden="true">
            {school.name.slice(0, 1).toUpperCase()}
          </span>
          <SchoolLogo logoURL={school.logoURL} size={44} />
        </span>
        <div>
          <h1>{`People at ${school.name}`}</h1>
          <p className="lede">
            Members who chose this school as their home school. People who chose
            to hide themselves are not shown.
          </p>
        </div>
      </header>

      <PeopleResults
        emptyHeading="No members yet"
        emptyMessage="People who pick this school as their home school will show up here."
        result={people}
        rows
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
              <ArrowRight aria-hidden="true" size={16} strokeWidth={2} />
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
              <ArrowLeft aria-hidden="true" size={16} strokeWidth={2} />
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

function SchoolPeopleError() {
  return (
    <RouteErrorView
      eyebrow="Members unavailable"
      heading="We could not load this list."
      description="Please try again in a moment."
      showNavigation={false}
    />
  );
}
