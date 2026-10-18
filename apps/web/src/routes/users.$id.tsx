import { SchoolLogo } from "../components/school-logo";
import { Link, createFileRoute, notFound } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Flag, ShieldCheck } from "lucide-react";
import { type FormEvent, useState } from "react";
import { FormField } from "../components/form-field";
import {
  newIdempotencyKey,
  useIdempotencyKey,
} from "../components/idempotency-key";
import { Avatar } from "../components/avatar";
import { KeyInformation } from "../components/key-information";
import { StatusLabel } from "../components/status-label";
import { PageNoticeView } from "../components/page-notice-view";
import { RouteErrorView, RoutePending } from "../components/route-boundaries";
import type {
  PublicProfileDTO,
  ReportUserResult,
  ViewerRelationship,
} from "../features/public-profile/contracts";
import { validatePublicProfileSearch } from "../features/public-profile/contracts";
import { SocialLinkIcon } from "../features/public-profile/social-link-icon";
import profileCSS from "../features/public-profile/profile.css?url";
import { ProfileGameLists } from "../features/profile-games/profile-game-lists";
import { socialSite } from "../features/public-profile/social-sites";
import {
  getPublicProfilePage,
  reportUser,
} from "../features/public-profile/public-profile.functions";
import {
  publicProfileHead,
  publicProfileHomeSchool,
  reportUserNotices,
  roleIndicatorLabel,
  safeHTTPURL,
  verificationLabel,
} from "../features/public-profile/presentation";

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
  head: ({ loaderData }) => {
    const head = publicProfileHead(loaderData);
    return {
      ...head,
      links: [...head.links, { rel: "stylesheet", href: profileCSS }],
    };
  },
  pendingComponent: PublicProfilePending,
  errorComponent: PublicProfileError,
  component: PublicProfilePage,
});

function PublicProfilePage() {
  const { profile, viewer } = Route.useLoaderData();
  const search = Route.useSearch();
  const homeSchool = publicProfileHomeSchool(profile);
  const savedLinks = profile.social_links ?? [];
  const socialLinks = savedLinks.flatMap((link): typeof savedLinks => {
    // A Discord username has no URL to check.
    if (link.kind === "discord") return [link];
    const url = safeHTTPURL(link.url);
    return url ? [{ ...link, url }] : [];
  });

  return (
    <main className="public-profile">
      <header className="panel public-profile__header">
        <Avatar id={profile.id} name={profile.name} />
        <div className="public-profile__body">
          <h1>{profile.name}</h1>
          {profile.home_school ? (
            <p className="public-profile__school">
              <Link
                to="/schools/$slug"
                params={{ slug: profile.home_school.slug }}
              >
                <SchoolLogo
                  inline
                  logoURL={profile.home_school.logo_url}
                  size={20}
                />
                {homeSchool.name}
              </Link>
            </p>
          ) : null}
          <div className="tag-list" aria-label="Profile verification">
            {profile.role_indicators?.includes("site_admin") ? (
              <StatusLabel tone="admin">
                <ShieldCheck aria-hidden="true" size={14} strokeWidth={2.25} />
                {roleIndicatorLabel("site_admin")}
              </StatusLabel>
            ) : null}
            <StatusLabel
              tone={profile.verification_level === "basic" ? undefined : "info"}
            >
              {verificationLabel(profile.verification_level)}
            </StatusLabel>
            {profile.role_indicators
              ?.filter((role) => role !== "site_admin")
              .map((role) => (
                <StatusLabel key={role}>{roleIndicatorLabel(role)}</StatusLabel>
              ))}
          </div>
          {profile.bio?.trim() ? (
            <p className="public-profile__bio">{profile.bio}</p>
          ) : viewer === "self" ? (
            <p className="public-profile__bio muted">
              You have not written a bio yet.{" "}
              <Link to="/settings/profile">Add one</Link>
            </p>
          ) : null}
        </div>
        {viewer === "self" ? (
          <div className="public-profile__actions">
            <Link className="button button--secondary" to="/settings/profile">
              Edit profile
            </Link>
          </div>
        ) : null}
      </header>

      <PageNoticeView
        notice={search.report ? reportUserNotices[search.report] : undefined}
      />

      <div className="layout-detail">
        <div className="layout-detail__main">
          <section
            aria-labelledby="social-links"
            className="panel panel--flush"
          >
            <div className="panel__header">
              <h2 id="social-links">Links</h2>
            </div>
            {socialLinks.length > 0 ? (
              <ul className="public-profile__links">
                {socialLinks.map((link) =>
                  link.kind === "discord" ? (
                    // A Discord username has no page to link to, so it is text.
                    <li key={link.id ?? `discord-${link.username}`}>
                      <span className="social-link">
                        <SocialLinkIcon site="discord" />
                        Discord: {link.username}
                      </span>
                    </li>
                  ) : (
                    <li key={link.id ?? `${link.label}-${link.url}`}>
                      <a className="social-link" href={link.url}>
                        <SocialLinkIcon site={socialSite(link.url)} />
                        {link.label.trim() || "Profile link"}
                      </a>
                    </li>
                  ),
                )}
              </ul>
            ) : (
              <p className="panel__body muted">
                {viewer === "self" ? (
                  <>
                    You have not added any links.{" "}
                    <Link to="/settings/profile">Add social links</Link>
                  </>
                ) : (
                  "No public links yet."
                )}
              </p>
            )}
          </section>
          <ProfileGameLists lists={profile.games} self={viewer === "self"} />
        </div>

        <aside className="layout-detail__aside" aria-label="About this player">
          <KeyInformation
            title="About"
            facts={[
              {
                term: "Home school",
                value: profile.home_school ? (
                  <Link
                    className="public-profile__school-link"
                    to="/schools/$slug"
                    params={{ slug: profile.home_school.slug }}
                  >
                    <span className="school-directory-mark">
                      <span aria-hidden="true">
                        {profile.home_school.name.slice(0, 1).toUpperCase()}
                      </span>
                      <SchoolLogo
                        logoURL={profile.home_school.logo_url}
                        size={36}
                      />
                    </span>
                    <span>{homeSchool.name}</span>
                  </Link>
                ) : (
                  homeSchool.name
                ),
              },
              ...(homeSchool.location
                ? [{ term: "Location", value: homeSchool.location }]
                : []),
              {
                term: "Member type",
                value: verificationLabel(profile.verification_level),
              },
              ...(profile.role_indicators && profile.role_indicators.length > 0
                ? [
                    {
                      term: "Roles",
                      value: profile.role_indicators
                        .map(roleIndicatorLabel)
                        .join(", "),
                    },
                  ]
                : []),
            ]}
          />
        </aside>
      </div>

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

function PublicProfileError() {
  return (
    <RouteErrorView
      eyebrow="Profile unavailable"
      heading="We could not load this profile."
    />
  );
}
