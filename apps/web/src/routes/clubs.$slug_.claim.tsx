import { createFileRoute, notFound, redirect } from "@tanstack/react-router";
import { BreadcrumbLink, Breadcrumbs } from "../components/breadcrumbs";
import { ButtonLink } from "../components/button-link";
import { Callout } from "../components/callout";
import { pageHead } from "../components/public-page-head";
import { RouteErrorView, RoutePending } from "../components/route-boundaries";
import {
  ClaimSubmitted,
  ClubClaimForm,
} from "../features/club-slice/claim-form";
import {
  getClaimViewer,
  getClubDetail,
} from "../features/club-slice/club.functions";
import { validateClaimSearch } from "../features/club-slice/contracts";

export const Route = createFileRoute("/clubs/$slug_/claim")({
  validateSearch: validateClaimSearch,
  loader: async ({ context, params }) => {
    const path: `/${string}` = `/clubs/${encodeURIComponent(params.slug)}/claim`;
    const [viewer, result] = await Promise.all([
      getClaimViewer(),
      getClubDetail({ data: { slug: params.slug } }),
    ]);
    if (!viewer.signedIn)
      throw redirect({ to: "/login", search: { next: path } });
    if (result.status === "not_found") throw notFound();
    if (result.status !== "found")
      throw new Error("Club detail is unavailable");
    return { club: result.club, path, publicOrigin: context.publicOrigin };
  },
  staleTime: 0,
  headers: () => ({ "cache-control": "private, no-store", vary: "Cookie" }),
  head: ({ loaderData }) =>
    pageHead(loaderData?.publicOrigin, {
      title: loaderData ? `Claim ${loaderData.club.name}` : "Claim a club",
      description: "Ask to manage a club's page on Campus Gaming Network.",
      path: loaderData?.path ?? "/clubs",
      noIndex: true,
    }),
  pendingComponent: () => <RoutePending message="Loading claim form…" />,
  errorComponent: () => (
    <RouteErrorView
      eyebrow="Claim unavailable"
      heading="We could not load the claim form."
    />
  ),
  component: ClaimClubPage,
});

function ClaimClubPage() {
  const { club } = Route.useLoaderData();
  const search = Route.useSearch();
  const back = (
    <ButtonLink
      params={{ slug: club.slug }}
      to="/clubs/$slug"
      variant="secondary"
    >
      Back to {club.name}
    </ButtonLink>
  );

  return (
    <main className="form-page">
      <Breadcrumbs current="Claim">
        <BreadcrumbLink to="/clubs/$slug" params={{ slug: club.slug }}>
          {club.name}
        </BreadcrumbLink>
      </Breadcrumbs>
      <section className="page-heading">
        <div>
          <h1>Claim {club.name}</h1>
          <p className="lede">
            Officers who claim their club become its owner on Campus Gaming
            Network, and the page then says it is managed by the club.
          </p>
        </div>
      </section>
      {search.claim === "submitted" ? (
        <>
          <ClaimSubmitted>
            Your claim on {club.name} is waiting for review.
          </ClaimSubmitted>
          <div className="form-actions">{back}</div>
        </>
      ) : club.claimed ? (
        <>
          <Callout>
            {club.name} is already managed by its officers. If you run it and
            cannot reach them, contact support.
          </Callout>
          <div className="form-actions">{back}</div>
        </>
      ) : (
        <ClubClaimForm
          outcome={search.claim}
          submitLabel="Send claim"
          target={{ kind: "claim", slug: club.slug }}
        />
      )}
    </main>
  );
}
