import {
  Link,
  createFileRoute,
  notFound,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Flag } from "lucide-react";
import { type FormEvent, useState } from "react";
import { FormField } from "../components/form-field";
import {
  newIdempotencyKey,
  useIdempotencyKey,
} from "../components/idempotency-key";
import { Avatar } from "../components/avatar";
import { PageNoticeView } from "../components/page-notice-view";
import { RouteErrorView, RoutePending } from "../components/route-boundaries";
import type {
  PublicProfileDTO,
  ReportUserResult,
  ViewerRelationship,
} from "../features/public-profile/contracts";
import { validatePublicProfileSearch } from "../features/public-profile/contracts";
import { SocialLinkIcon } from "../features/public-profile/social-link-icon";
import {
  getPublicProfilePage,
  reportUser,
} from "../features/public-profile/public-profile.functions";
import {
  publicProfileHomeSchool,
  publicProfileMetadata,
  reportUserNotices,
  roleIndicatorLabel,
  safeHTTPURL,
  verificationLabel,
} from "../features/public-profile/presentation";

const siteName = "Campus Gaming Network";

export type PublicProfileRouteData = {
  profile: PublicProfileDTO;
  publicOrigin: string;
  viewer: ViewerRelationship;
  hasSessionCookie: boolean;
  /** Server-rendered report key; see useIdempotencyKey. */
  idempotencyKey: string;
};

export const Route = createFileRoute("/users/$id")({
  validateSearch: validatePublicProfileSearch,
  loader: async ({ context, params }): Promise<PublicProfileRouteData> => {
    const result = await getPublicProfilePage({ data: { id: params.id } });

    if (result.status === "not_found") {
      throw notFound();
    }

    if (result.status !== "found") {
      throw new Error("Public profile unavailable");
    }

    return {
      profile: result.profile,
      publicOrigin: context.publicOrigin,
      viewer: result.viewer,
      hasSessionCookie: result.hasSessionCookie,
      idempotencyKey: newIdempotencyKey(),
    };
  },
  headers: ({ loaderData }) => ({
    "cache-control": loaderData?.hasSessionCookie
      ? "private, no-store"
      : "public, max-age=0, must-revalidate",
    vary: "Cookie",
  }),
  head: ({ loaderData }) => publicProfileHead(loaderData),
  pendingComponent: PublicProfilePending,
  errorComponent: PublicProfileError,
  component: PublicProfilePage,
});

export function publicProfileHead(loaderData?: PublicProfileRouteData) {
  if (!loaderData) {
    return {
      meta: [
        { title: `Public profile | ${siteName}` },
        { name: "robots", content: "noindex,nofollow" },
      ],
    };
  }

  const metadata = publicProfileMetadata(
    loaderData.profile,
    loaderData.publicOrigin,
  );

  return {
    meta: [
      { title: metadata.title },
      { name: "description", content: metadata.description },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: siteName },
      { property: "og:title", content: metadata.title },
      { property: "og:description", content: metadata.description },
      { property: "og:url", content: metadata.url },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: metadata.title },
      { name: "twitter:description", content: metadata.description },
    ],
  };
}

function PublicProfilePage() {
  const { profile, viewer } = Route.useLoaderData();
  const search = Route.useSearch();
  const homeSchool = publicProfileHomeSchool(profile);
  const socialLinks = (profile.social_links ?? []).flatMap((link) => {
    const url = safeHTTPURL(link.url);
    return url ? [{ ...link, url }] : [];
  });

  return (
    <main className="narrow">
      <section className="profile-hero">
        <Avatar id={profile.id} name={profile.name} />
        <div>
          <p className="eyebrow">Public profile</p>
          <h1>{profile.name}</h1>
          <p className="lede">
            {profile.bio || "This profile is ready for campus gaming activity."}
          </p>
          <div className="pill-list" aria-label="Profile verification">
            <span>{verificationLabel(profile.verification_level)}</span>
            {profile.role_indicators?.map((role) => (
              <span key={role}>{roleIndicatorLabel(role)}</span>
            ))}
          </div>
        </div>
      </section>

      <PageNoticeView
        notice={search.report ? reportUserNotices[search.report] : undefined}
      />

      <section className="detail-grid" aria-label="Profile details">
        <div className="detail-row">
          <span>Home school</span>
          <strong className="detail-value">
            {profile.home_school ? (
              <Link
                className="link"
                to="/schools/$slug"
                params={{ slug: profile.home_school.slug }}
              >
                {homeSchool.name}
              </Link>
            ) : (
              homeSchool.name
            )}
            {homeSchool.location ? <small>{homeSchool.location}</small> : null}
          </strong>
        </div>
      </section>

      {socialLinks.length > 0 ? (
        <section className="section" aria-labelledby="social-links">
          <h2 id="social-links">Links</h2>
          <div className="pill-list">
            {socialLinks.map((link) => (
              <a
                className="social-link"
                href={link.url}
                key={link.id ?? `${link.label}-${link.url}`}
              >
                <SocialLinkIcon url={link.url} />
                {link.label.trim() || "Profile link"}
              </a>
            ))}
          </div>
        </section>
      ) : (
        <p>No public links yet.</p>
      )}

      <ProfileSafety profileID={profile.id} viewer={viewer} />
    </main>
  );
}

/**
 * Reporting is a quiet line at the end of the page. Your own profile has
 * nothing to report, a visitor is sent to log in first, and anyone else opens
 * the form on demand.
 */
function ProfileSafety({
  profileID,
  viewer,
}: {
  profileID: string;
  viewer: ViewerRelationship;
}) {
  if (viewer === "self") {
    return null;
  }

  if (viewer === "anonymous") {
    return (
      <p className="safety-prompt">
        <Link
          className="safety-link"
          to="/login"
          search={{ next: `/users/${profileID}` }}
        >
          <Flag aria-hidden="true" size={14} strokeWidth={1.75} />
          Log in to report this user
        </Link>
      </p>
    );
  }

  return (
    <details className="safety-details">
      <summary>
        <Flag aria-hidden="true" size={14} strokeWidth={1.75} />
        Report this user
      </summary>
      <ReportUserForm userID={profileID} />
    </details>
  );
}

function ReportUserForm({ userID }: { userID: string }) {
  const runReportUser = useServerFn(reportUser);
  const idempotency = useIdempotencyKey(
    Route.useLoaderData({ select: (data) => data.idempotencyKey }),
  );
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ReportUserResult>();
  const reasonErrors =
    result?.status === "error" ? result.fieldErrors?.reason : undefined;

  async function submit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    const formElement = formEvent.currentTarget;
    const formData = new FormData(formElement);
    setPending(true);
    setResult(undefined);
    try {
      const next = await runReportUser({
        data: {
          userID,
          reason: String(formData.get("reason") ?? ""),
          idempotency_key: idempotency.key,
        },
      });
      setResult(next);
      if (next.status === "success") {
        formElement.reset();
        idempotency.rotate();
      }
    } catch {
      setResult({
        status: "error",
        message: "We could not submit that report. Please try again.",
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      action={reportUser.url}
      className="form-stack report-form"
      method="post"
      onSubmit={submit}
    >
      <input name="user_id" type="hidden" value={userID} />
      <input name="idempotency_key" type="hidden" value={idempotency.key} />
      {result ? (
        <p
          aria-live="polite"
          role={result.status === "error" ? "alert" : "status"}
        >
          {result.message}
        </p>
      ) : null}
      <FormField
        errorId="user-report-reason-error"
        errors={reasonErrors}
        label="Reason"
      >
        <textarea
          maxLength={2000}
          name="reason"
          placeholder="Tell us what looks unsafe, abusive, spammy, or misleading."
          required
          rows={4}
        />
      </FormField>
      <button disabled={pending} type="submit">
        {pending ? "Submitting…" : "Submit report"}
      </button>
    </form>
  );
}

function PublicProfilePending() {
  return <RoutePending message="Loading profile…" />;
}

function PublicProfileError({ reset }: ErrorComponentProps) {
  return (
    <RouteErrorView
      reset={reset}
      eyebrow="Profile unavailable"
      heading="We could not load this profile."
    />
  );
}
