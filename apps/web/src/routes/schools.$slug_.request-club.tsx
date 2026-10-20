import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { BreadcrumbLink, Breadcrumbs } from "../components/breadcrumbs";
import { ButtonLink } from "../components/button-link";
import { pageHead } from "../components/public-page-head";
import { RouteErrorView, RoutePending } from "../components/route-boundaries";
import {
  ClaimSubmitted,
  ClubClaimForm,
} from "../features/club-slice/claim-form";
import { getClaimViewer } from "../features/club-slice/club.functions";
import { validateClaimSearch } from "../features/club-slice/contracts";
import { getSchoolCatalog } from "../features/school-slice/catalog.functions";

export const Route = createFileRoute("/schools/$slug_/request-club")({
  validateSearch: validateClaimSearch,
  loader: async ({ context, params }) => {
    const path: `/${string}` = `/schools/${encodeURIComponent(params.slug)}/request-club`;
    const [viewer, catalog] = await Promise.all([
      getClaimViewer(),
      getSchoolCatalog({ data: { slug: params.slug } }),
    ]);
    if (!viewer.signedIn)
      throw redirect({ to: "/login", search: { next: path } });
    if (catalog.status === "not_found") throw notFound();
    if (catalog.status !== "found")
      throw new Error("School detail is unavailable");
    return { school: catalog.school, path, publicOrigin: context.publicOrigin };
  },
  staleTime: 0,
  headers: () => ({ "cache-control": "private, no-store", vary: "Cookie" }),
  head: ({ loaderData }) =>
    pageHead(loaderData?.publicOrigin, {
      title: loaderData
        ? `Request a club at ${loaderData.school.name}`
        : "Request a club",
      description:
        "Ask for a club that Campus Gaming Network does not list yet.",
      path: loaderData?.path ?? "/clubs",
      noIndex: true,
    }),
  pendingComponent: () => <RoutePending message="Loading request form…" />,
  errorComponent: () => (
    <RouteErrorView
      eyebrow="Request unavailable"
      heading="We could not load the request form."
    />
  ),
  component: RequestClubPage,
});

function RequestClubPage() {
  const { school } = Route.useLoaderData();
  const search = Route.useSearch();

  return (
    <main className="form-page">
      <Breadcrumbs current="Request a club">
        <BreadcrumbLink to="/schools/$slug" params={{ slug: school.slug }}>
          {school.name}
        </BreadcrumbLink>
      </Breadcrumbs>
      <section className="page-heading">
        <div>
          <h1>Request a club at {school.name}</h1>
          <p className="lede">
            Run a gaming club or esports program that is not listed? Once a site
            admin confirms you run it, the club gets a page and you become its
            owner.
          </p>
        </div>
      </section>
      {search.claim === "submitted" ? (
        <>
          <ClaimSubmitted>Your request is waiting for review.</ClaimSubmitted>
          <div className="form-actions">
            <ButtonLink
              params={{ slug: school.slug }}
              to="/schools/$slug"
              variant="secondary"
            >
              Back to {school.name}
            </ButtonLink>
          </div>
        </>
      ) : (
        <ClubClaimForm
          outcome={search.claim}
          submitLabel="Send request"
          target={{ kind: "request", schoolSlug: school.slug }}
        />
      )}
    </main>
  );
}
