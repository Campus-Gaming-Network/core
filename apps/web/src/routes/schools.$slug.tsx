import {
  Link,
  createFileRoute,
  notFound,
  type ErrorComponentProps
} from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { type FormEvent } from "react";
import { useEnhancedMutation } from "../components/enhanced-mutation";
import {
  RouteErrorView,
  RoutePending
} from "../components/route-boundaries";
import {
  getSchoolCatalog,
  getSchoolViewerState
} from "../features/school-slice/catalog.functions";
import {
  followSchool,
  unfollowSchool
} from "../features/school-slice/school-follow.functions";
import {
  validateSchoolsSearch,
  type SchoolDTO,
  type SchoolsSearch
} from "../features/school-slice/contracts";
import {
  schoolHead,
  schoolLocation,
  safeSchoolWebsite
} from "../features/school-slice/presentation";

export type SchoolRouteData = {
  school: SchoolDTO;
  viewer: Awaited<ReturnType<typeof getSchoolViewerState>>;
  publicOrigin: string;
};

export const Route = createFileRoute("/schools/$slug")({
  validateSearch: validateSchoolsSearch,
  loader: async ({ context, params }): Promise<SchoolRouteData> => {
    const catalog = await getSchoolCatalog({ data: { slug: params.slug } });
    if (catalog.status === "not_found") {
      throw notFound();
    }
    if (catalog.status !== "found") {
      throw new Error("School detail is unavailable");
    }
    return {
      school: catalog.school,
      viewer: await getSchoolViewerState({ data: { schoolId: catalog.school.id } }),
      publicOrigin: context.publicOrigin
    };
  },
  staleTime: 0,
  headers: () => ({
    "cache-control": "private, no-store",
    vary: "Cookie"
  }),
  head: ({ loaderData }) =>
    schoolHead(loaderData?.school, loaderData?.publicOrigin),
  pendingComponent: SchoolPending,
  errorComponent: SchoolError,
  component: SchoolPage
});

function SchoolPage() {
  const { school, viewer } = Route.useLoaderData();
  const search = Route.useSearch();
  const website = safeSchoolWebsite(school.website_url);

  return (
    <main className="narrow">
      <section className="page-heading">
        <p className="eyebrow">School</p>
        <h1>{school.name}</h1>
        <p className="lede">
          {[school.city, school.state, school.zip].filter(Boolean).join(", ") ||
            "Location details pending"}
        </p>
      </section>

      {search.follow ? <FollowNotice status={search.follow} /> : null}

      <section className="detail-grid" aria-label="School details">
        <div className="detail-row">
          <span>Campus type</span>
          <strong>{school.is_main_campus ? "Main campus" : "Branch campus"}</strong>
        </div>
        <div className="detail-row">
          <span>Known branches</span>
          <strong>{school.num_branches}</strong>
        </div>
        {school.unitid ? (
          <div className="detail-row">
            <span>Scorecard unit ID</span>
            <strong>{school.unitid}</strong>
          </div>
        ) : null}
        {website ? (
          <div className="detail-row">
            <span>Website</span>
            <a href={website}>{school.website_url}</a>
          </div>
        ) : null}
      </section>

      <section className="action-panel" aria-labelledby="school-actions">
        <h2 id="school-actions">School actions</h2>
        {viewer.authenticated ? (
          viewer.isHomeSchool ? (
            <p role="status">This is your home school.</p>
          ) : viewer.isFollowing ? (
            <>
              <p role="status">You are following this school.</p>
              <SchoolFollowForm following school={school} />
            </>
          ) : (
            <SchoolFollowForm following={false} school={school} />
          )
        ) : (
          <div className="actions">
            <Link className="button button--primary" to="/signup">
              Create account
            </Link>
            <Link
              className="button button--secondary"
              to="/login"
              search={{ next: `/schools/${school.slug}` }}
            >
              Log in to follow
            </Link>
          </div>
        )}
      </section>

      <p>
        <Link to="/schools">Browse all schools</Link>
        {schoolLocation(school, "") ? ` · ${schoolLocation(school)}` : ""}
      </p>
    </main>
  );
}

function SchoolFollowForm({
  following,
  school
}: {
  following: boolean;
  school: Pick<SchoolDTO, "id" | "slug">;
}) {
  const runFollowSchool = useServerFn(followSchool);
  const runUnfollowSchool = useServerFn(unfollowSchool);
  const mutation = useEnhancedMutation(
    "We could not update this school follow. Please try again."
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = { school_id: school.id, slug: school.slug };
    await mutation.execute(() =>
      following
        ? runUnfollowSchool({ data: input })
        : runFollowSchool({ data: input })
    );
  }

  const action = following ? unfollowSchool.url : followSchool.url;
  return (
    <form action={action} method="post" onSubmit={submit}>
      <input name="school_id" type="hidden" value={school.id} />
      <input name="slug" type="hidden" value={school.slug} />
      {mutation.message ? (
        <p role="alert" aria-live="polite">
          {mutation.message}
        </p>
      ) : null}
      <button
        className={following ? "button button--secondary" : undefined}
        disabled={mutation.pending}
        type="submit"
      >
        {mutation.pending
          ? following
            ? "Unfollowing…"
            : "Following…"
          : following
            ? "Unfollow"
            : "Follow school"}
      </button>
    </form>
  );
}

function FollowNotice({ status }: { status: NonNullable<SchoolsSearch["follow"]> }) {
  const messages = {
    added: "School followed.",
    failed: "We could not update this school follow. Please try again.",
    removed: "School unfollowed."
  } as const;
  return (
    <p role={status === "failed" ? "alert" : "status"} aria-live="polite">
      {messages[status]}
    </p>
  );
}

function SchoolPending() {
  return <RoutePending message="Loading school…" />;
}

function SchoolError({ reset }: ErrorComponentProps) {
  return (
    <RouteErrorView
      reset={reset}
      eyebrow="School unavailable"
      heading="We could not load this school."
    />
  );
}
