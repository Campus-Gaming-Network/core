import {
  Link,
  createFileRoute,
  notFound,
  type ErrorComponentProps
} from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { type FormEvent, useState } from "react";
import {
  FieldError,
  fieldErrorProps
} from "../components/enhanced-mutation";
import {
  RouteErrorView,
  RoutePending
} from "../components/route-boundaries";
import type {
  PublicProfileDTO,
  ReportUserNotice,
  ReportUserResult,
  ViewerRelationship
} from "../features/public-profile/contracts";
import { validatePublicProfileSearch } from "../features/public-profile/contracts";
import {
  getPublicProfilePage,
  reportUser
} from "../features/public-profile/public-profile.functions";
import {
  publicProfileHomeSchool,
  publicProfileMetadata,
  roleIndicatorLabel,
  safeHTTPURL,
  userInitials,
  verificationLabel
} from "../features/public-profile/presentation";

const siteName = "Campus Gaming Network";

export type PublicProfileRouteData = {
  profile: PublicProfileDTO;
  publicOrigin: string;
  viewer: ViewerRelationship;
  hasSessionCookie: boolean;
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
      hasSessionCookie: result.hasSessionCookie
    };
  },
  headers: ({ loaderData }) => ({
    "cache-control": loaderData?.hasSessionCookie
      ? "private, no-store"
      : "public, max-age=0, must-revalidate",
    vary: "Cookie"
  }),
  head: ({ loaderData }) => publicProfileHead(loaderData),
  pendingComponent: PublicProfilePending,
  errorComponent: PublicProfileError,
  component: PublicProfilePage
});

export function publicProfileHead(loaderData?: PublicProfileRouteData) {
  if (!loaderData) {
    return {
      meta: [
        { title: `Public profile | ${siteName}` },
        { name: "robots", content: "noindex,nofollow" }
      ]
    };
  }

  const metadata = publicProfileMetadata(
    loaderData.profile,
    loaderData.publicOrigin
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
      { name: "twitter:description", content: metadata.description }
    ]
  };
}

function PublicProfilePage() {
  const { profile, viewer } = Route.useLoaderData();
  const search = Route.useSearch();
  const homeSchool = publicProfileHomeSchool(profile);
  const avatarURL = safeHTTPURL(profile.avatar_url);
  const socialLinks = (profile.social_links ?? []).flatMap((link) => {
    const url = safeHTTPURL(link.url);
    return url ? [{ ...link, url }] : [];
  });

  return (
    <main className="narrow">
      <section className="profile-hero">
        <span className="user-avatar" aria-hidden="true">
          {avatarURL ? <img src={avatarURL} alt="" /> : userInitials(profile.name)}
        </span>
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

      <section className="detail-grid" aria-label="Profile details">
        <div className="detail-row">
          <span>Verification</span>
          <strong>{verificationLabel(profile.verification_level)}</strong>
        </div>
        {profile.role_indicators && profile.role_indicators.length > 0 ? (
          <div className="detail-row">
            <span>Roles</span>
            <strong>
              {profile.role_indicators.map(roleIndicatorLabel).join(", ")}
            </strong>
          </div>
        ) : null}
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
              <a href={link.url} key={link.id ?? `${link.label}-${link.url}`}>
                {link.label.trim() || "Profile link"}
              </a>
            ))}
          </div>
        </section>
      ) : (
        <p>No public links yet.</p>
      )}

      <section className="action-panel" aria-labelledby="profile-safety">
        <h2 id="profile-safety">Safety</h2>
        <ProfileSafety
          notice={search.report}
          profileID={profile.id}
          viewer={viewer}
        />
      </section>
    </main>
  );
}

function ProfileSafety({
  notice,
  profileID,
  viewer
}: {
  notice?: ReportUserNotice;
  profileID: string;
  viewer: ViewerRelationship;
}) {
  const noticeView = notice ? <ReportUserNoticeView notice={notice} /> : null;

  if (viewer === "self") {
    return (
      <>
        {noticeView}
        <p className="form-help">This is your profile.</p>
      </>
    );
  }

  if (viewer === "anonymous") {
    return (
      <>
        {noticeView}
        <Link
          className="button button--primary"
          to="/login"
          search={{ next: `/users/${profileID}` }}
        >
          Log in to report this profile
        </Link>
      </>
    );
  }

  return (
    <>
      {noticeView}
      <ReportUserForm userID={profileID} />
    </>
  );
}

function ReportUserForm({ userID }: { userID: string }) {
  const runReportUser = useServerFn(reportUser);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ReportUserResult>();
  const reasonErrors = result?.status === "error"
    ? result.fieldErrors?.reason
    : undefined;

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
          reason: String(formData.get("reason") ?? "")
        }
      });
      setResult(next);
      if (next.status === "success") formElement.reset();
    } catch {
      setResult({
        status: "error",
        message: "We could not submit that report. Please try again."
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
      {result ? (
        <p
          aria-live="polite"
          role={result.status === "error" ? "alert" : "status"}
        >
          {result.message}
        </p>
      ) : null}
      <label>
        Reason
        <textarea
          maxLength={2000}
          name="reason"
          placeholder="Tell us what looks unsafe, abusive, spammy, or misleading."
          required
          rows={4}
          {...fieldErrorProps(reasonErrors, "user-report-reason-error")}
        />
        <FieldError id="user-report-reason-error" messages={reasonErrors} />
      </label>
      <button disabled={pending} type="submit">
        {pending ? "Submitting…" : "Submit report"}
      </button>
    </form>
  );
}

function ReportUserNoticeView({ notice }: { notice: ReportUserNotice }) {
  const failed = notice === "failed";
  return (
    <p aria-live="polite" role={failed ? "alert" : "status"}>
      {failed
        ? "We could not submit that report. Please try again."
        : "Report submitted for review."}
    </p>
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
