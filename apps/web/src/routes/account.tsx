import {
  Link,
  createFileRoute,
  redirect,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, Check } from "lucide-react";
import { type FormEvent, type ReactNode, useRef, useState } from "react";
import { CalendarDate } from "../components/calendar-date";
import { EventCounts } from "../components/event-counts";
import { ConfirmDialog } from "../components/confirm-dialog";
import {
  FormErrorSummary,
  useEnhancedMutation,
} from "../components/enhanced-mutation";
import { FormField, RequiredFieldsNote } from "../components/form-field";
import { FormSection } from "../components/form-section";
import {
  deleteAccount,
  getAccountDashboard,
  updateAccountProfile,
} from "../features/account-slice/account.functions";
import {
  accountHead,
  accountNotices,
} from "../features/account-slice/presentation";
import {
  type AccountProfileDTO,
  type DashboardEventDTO,
  dashboardEventLimit,
} from "../features/account-slice/contracts";
import { pageNoticeKey } from "../components/page-notice";
import { Avatar } from "../components/avatar";
import { PageNoticeView } from "../components/page-notice-view";
import { RouteErrorView, RoutePending } from "../components/route-boundaries";
import { StatusLabel } from "../components/status-label";
import {
  eventLifecycleLabel,
  eventRSVPLabel,
  eventTimeRange,
} from "../features/event-slice/presentation";
import { schoolLocation } from "../features/school-slice/presentation";
import { teamRoleLabel } from "../features/team-slice/presentation";
import accountCSS from "../features/account-slice/account.css?url";

// The API accepts at most three social links; rows are numbered from zero.
const socialLinkSlots = [0, 1, 2];

// The dashboard shows this many rows of each event list.
const dashboardPreviewCount = 3;

export const Route = createFileRoute("/account")({
  validateSearch: (search: Record<string, unknown>) => {
    const account = pageNoticeKey(accountNotices, search.account);
    return account ? { account } : {};
  },
  loader: async ({ context }) => {
    const dashboard = await getAccountDashboard();
    if (dashboard.status === "unauthenticated") {
      throw redirect({ to: "/login", search: { next: "/account" } });
    }
    if (dashboard.status !== "found") {
      throw new Error("Account details are unavailable");
    }
    return { ...dashboard, publicOrigin: context.publicOrigin };
  },
  staleTime: 0,
  headers: () => ({ "cache-control": "private, no-store", vary: "Cookie" }),
  head: ({ loaderData }) => ({
    ...accountHead(loaderData?.publicOrigin),
    links: [{ rel: "stylesheet", href: accountCSS }],
  }),
  pendingComponent: AccountPending,
  errorComponent: AccountError,
  component: AccountPage,
});

function AccountPage() {
  const data = Route.useLoaderData();
  const search = Route.useSearch();
  const emailVerified = Boolean(data.profile.email_verified_at);

  return (
    <main className="narrow account-page">
      <header className="account-header">
        <Avatar id={data.profile.id} name={data.profile.name} />
        <div className="account-identity">
          <p className="eyebrow">Account</p>
          <h1>{data.profile.name}</h1>
          <p className="account-meta">
            <span>{data.profile.email}</span>
            <span className={emailVerified ? "account-verified" : undefined}>
              {emailVerified ? (
                <>
                  <Check aria-hidden="true" size={14} strokeWidth={2.25} />
                  Email verified
                </>
              ) : (
                "Email pending"
              )}
            </span>
          </p>
        </div>
        <Link
          className="link account-public-link with-arrow"
          to="/users/$id"
          params={{ id: data.profile.id }}
        >
          View public profile
          <ArrowRight aria-hidden="true" size={14} strokeWidth={2.25} />
        </Link>
      </header>

      <PageNoticeView
        notice={search.account ? accountNotices[search.account] : undefined}
      />

      {!emailVerified ? (
        <p role="alert">
          Verify your email to unlock normal authenticated use.
        </p>
      ) : null}

      <nav className="account-nav" aria-label="Account sections">
        <a href="#events">Events</a>
        <a href="#following">Following</a>
        <a href="#teams">Teams</a>
        <a href="#profile">Profile</a>
        <a href="#delete">Delete</a>
      </nav>

      <DashboardEventSection
        heading="Upcoming RSVPs"
        headingId="upcoming-rsvps-title"
        sectionId="events"
        empty={
          <>
            <p>You have no upcoming yes or maybe RSVPs.</p>
            <Link className="link" to="/events">
              Browse events
            </Link>
          </>
        }
        events={data.dashboardEvents.upcoming_rsvps}
        variant="rsvp"
      />
      <DashboardEventSection
        heading="Followed-school events"
        headingId="followed-school-events-title"
        sectionId="following"
        empty={<p>No upcoming public events from followed schools yet.</p>}
        events={data.dashboardEvents.followed_school_events}
        variant="followed"
      />

      <section
        className="section"
        id="followed-schools"
        aria-labelledby="followed-schools-title"
      >
        <div className="section-heading">
          <h2 id="followed-schools-title">Followed schools</h2>
          <Link className="link" to="/schools">
            Find schools
          </Link>
        </div>
        {data.followedSchools.length > 0 ? (
          <ul className="account-rows">
            {data.followedSchools.map((school) => (
              <li key={school.id}>
                <Link
                  className="account-row"
                  to="/schools/$slug"
                  params={{ slug: school.slug }}
                >
                  <strong>{school.name}</strong>
                  <small>{schoolLocation(school)}</small>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty-state">
            You are not following any additional schools yet.
          </p>
        )}
      </section>

      <section
        className="section"
        id="teams"
        aria-labelledby="team-activity-title"
      >
        <div className="section-heading">
          <h2 id="team-activity-title">Team activity</h2>
          <Link className="link" to="/teams">
            Find teams
          </Link>
        </div>
        {data.teams.length > 0 ? (
          <ul className="account-rows">
            {data.teams.map((team) => (
              <li key={team.id}>
                <Link
                  className="account-row"
                  to="/teams/$slug"
                  params={{ slug: team.slug }}
                >
                  <strong>{team.name}</strong>
                  <small>
                    {team.viewer_role
                      ? teamRoleLabel(team.viewer_role)
                      : "Member"}{" "}
                    · {team.member_count} member
                    {team.member_count === 1 ? "" : "s"}
                  </small>
                  <small className="account-row-detail">
                    {[
                      team.games.map((game) => game.name).join(", "),
                      team.school?.name ?? "Independent team",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </small>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty-state">
            You have not joined any teams yet. Join with a team password or
            create your first team.
          </p>
        )}
      </section>

      <ProfileForm profile={data.profile} />
      <DeleteAccountForm />
    </main>
  );
}

function DashboardEventSection({
  heading,
  headingId,
  sectionId,
  empty,
  events,
  variant,
}: {
  heading: string;
  headingId: string;
  sectionId: string;
  empty: ReactNode;
  events: DashboardEventDTO[];
  variant: "followed" | "rsvp";
}) {
  const shown = events.slice(0, dashboardPreviewCount);
  // The API cuts each list off at its limit, so a full list may be longer.
  const total =
    events.length >= dashboardEventLimit
      ? `${events.length}+`
      : String(events.length);

  return (
    <section
      className="section account-events"
      id={sectionId}
      aria-labelledby={headingId}
    >
      <div className="section-heading">
        <h2 id={headingId}>{heading}</h2>
      </div>
      {events.length > 0 ? (
        <>
          <div className="list">
            {shown.map((event) => (
              <Link
                className="card card--default list-item event-list-item"
                key={event.id}
                to="/events/$slug"
                params={{ slug: event.slug }}
              >
                <CalendarDate
                  decorative
                  startsAt={event.starts_at}
                  timezone={event.timezone}
                />
                <span className="event-card-copy">
                  {event.lifecycle === "upcoming" ? null : (
                    <StatusLabel status={event.lifecycle}>
                      {eventLifecycleLabel(event.lifecycle)}
                    </StatusLabel>
                  )}
                  <span className="event-card-heading">
                    <strong>{event.title}</strong>
                  </span>
                  <small>
                    {eventTimeRange(event)}
                    {variant === "rsvp" && event.viewer_rsvp
                      ? ` · RSVP: ${eventRSVPLabel(event.viewer_rsvp)}`
                      : ""}
                  </small>
                  <small>
                    {event.host_school.name} ·{" "}
                    {event.games.map((game) => game.name).join(", ")}
                  </small>
                  <EventCounts
                    going={event.rsvp_yes_count}
                    interested={event.interest_count}
                  />
                </span>
                <span className="event-card-action with-arrow">
                  View event
                  <ArrowRight aria-hidden="true" size={14} strokeWidth={2.25} />
                </span>
              </Link>
            ))}
          </div>
          {events.length > shown.length ? (
            <p className="account-more">
              <span>
                Showing {shown.length} of {total}
              </span>
              <Link className="link" to="/events">
                See all events
              </Link>
            </p>
          ) : null}
        </>
      ) : (
        <div className="empty-state">{empty}</div>
      )}
    </section>
  );
}

function ProfileForm({ profile }: { profile: AccountProfileDTO }) {
  const runUpdate = useServerFn(updateAccountProfile);
  const mutation = useEnhancedMutation(
    "We could not update your profile. Please try again.",
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const socialLinks = socialLinkSlots.flatMap((index) => {
      const label = String(form.get(`social_label_${index}`) ?? "");
      const url = String(form.get(`social_url_${index}`) ?? "");
      return label || url ? [{ label, url }] : [];
    });
    await mutation.execute(() =>
      runUpdate({
        data: {
          name: String(form.get("name") ?? ""),
          bio: String(form.get("bio") ?? ""),
          timezone: String(form.get("timezone") ?? ""),
          social_links: socialLinks,
          // A "false" input comes before the checkbox, so the last value is
          // the checkbox when it is checked and the "false" when it is not.
          show_in_lists: form.getAll("show_in_lists").at(-1) === "true",
        },
      }),
    );
  }

  const socialLinks = profile.social_links ?? [];
  const socialRows = socialLinkSlots.map((index) => (
    <div className="split-fields" key={index}>
      <FormField
        errorId={`profile-social_label_${index}-error`}
        errors={mutation.fieldErrors[`social_label_${index}`]}
        label="Label"
      >
        <input
          aria-label={`Social link ${index + 1} label`}
          defaultValue={socialLinks[index]?.label ?? ""}
          maxLength={40}
          name={`social_label_${index}`}
        />
      </FormField>
      <FormField
        errorId={`profile-social_url_${index}-error`}
        errors={mutation.fieldErrors[`social_url_${index}`]}
        label="URL"
      >
        <input
          aria-label={`Social link ${index + 1} URL`}
          defaultValue={socialLinks[index]?.url ?? ""}
          maxLength={500}
          name={`social_url_${index}`}
          type="url"
        />
      </FormField>
    </div>
  ));
  // Show the saved links plus one empty row. The remaining rows stay in the
  // form behind a native disclosure, so they submit with or without
  // JavaScript.
  const shownSocialRows = Math.min(socialRows.length, socialLinks.length + 1);
  const hiddenSocialRowHasError = socialLinkSlots
    .slice(shownSocialRows)
    .some(
      (index) =>
        mutation.fieldErrors[`social_label_${index}`] ||
        mutation.fieldErrors[`social_url_${index}`],
    );

  return (
    <section
      className="section"
      id="profile"
      aria-labelledby="profile-settings-title"
    >
      <div className="section-heading">
        <div>
          <h2 id="profile-settings-title">Profile settings</h2>
        </div>
      </div>
      <form
        action={updateAccountProfile.url}
        className="form-stack sectioned-form"
        method="post"
        onSubmit={submit}
      >
        <FormErrorSummary
          fieldErrors={mutation.fieldErrors}
          fieldIds={Object.fromEntries(
            Object.keys(mutation.fieldErrors).map((field) => [
              field,
              `profile-${field}-error`,
            ]),
          )}
          message={mutation.message}
          summaryRef={mutation.errorSummaryRef}
        />
        <RequiredFieldsNote />
        <FormSection
          title="About you"
          description="How other players see you on your public profile."
        >
          <FormField
            errorId="profile-name-error"
            errors={mutation.fieldErrors.name}
            label="Name"
          >
            <input
              name="name"
              autoComplete="name"
              defaultValue={profile.name}
              required
              maxLength={120}
            />
          </FormField>
          <FormField
            errorId="profile-bio-error"
            errors={mutation.fieldErrors.bio}
            label="Bio"
            optional
          >
            <textarea
              name="bio"
              defaultValue={profile.bio ?? ""}
              maxLength={2000}
              rows={5}
            />
          </FormField>
          <FormField
            errorId="profile-timezone-error"
            errors={mutation.fieldErrors.timezone}
            label="Time zone"
          >
            <input name="timezone" defaultValue={profile.timezone} required />
          </FormField>
        </FormSection>
        <FormSection
          title="Social links"
          description="Optional. Link to your profiles elsewhere. You can add up to three."
        >
          {socialRows.slice(0, shownSocialRows)}
          {shownSocialRows < socialRows.length ? (
            <details
              className="more-social-links"
              open={hiddenSocialRowHasError}
            >
              <summary>Add another link</summary>
              <div className="more-social-links-fields">
                {socialRows.slice(shownSocialRows)}
              </div>
            </details>
          ) : null}
        </FormSection>
        <FormSection
          title="Privacy"
          description="Choose how other signed-in people can find you."
        >
          <input name="show_in_lists" type="hidden" value="false" />
          <label className="checkbox-field">
            <input
              aria-describedby="profile-show-in-lists-help"
              defaultChecked={profile.show_in_lists}
              name="show_in_lists"
              type="checkbox"
              value="true"
            />
            <span>Show me in member lists</span>
          </label>
          <p className="form-help" id="profile-show-in-lists-help">
            Signed-in people can see you in lists of event attendees, school
            members, and team members. Turn this off to hide yourself.
          </p>
        </FormSection>
        <div className="form-actions">
          <button type="submit" disabled={mutation.pending}>
            {mutation.pending ? "Saving…" : "Save profile"}
          </button>
        </div>
      </form>
    </section>
  );
}

function DeleteAccountForm() {
  const runDelete = useServerFn(deleteAccount);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [confirming, setConfirming] = useState(false);
  const mutation = useEnhancedMutation(
    "We could not delete your account. Please try again.",
  );
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (!confirming && form.get("confirm") === "DELETE") {
      setConfirming(true);
      return;
    }
    await mutation.execute(() =>
      runDelete({ data: { confirm: String(form.get("confirm") ?? "") } }),
    );
  }
  const errors = mutation.fieldErrors.confirm;
  return (
    <section
      className="action-panel"
      id="delete"
      aria-labelledby="delete-account"
    >
      <h2 id="delete-account">Delete your account</h2>
      <p>
        This removes your profile, followed schools, and RSVPs and cannot be
        undone. Published events remain available without a link to you, and
        team ownership passes according to the API policy.
      </p>
      <form
        action={deleteAccount.url}
        className="form-stack sectioned-form"
        method="post"
        onSubmit={submit}
      >
        {!confirming ? (
          <FormErrorSummary
            fieldErrors={mutation.fieldErrors}
            fieldIds={{ confirm: "delete-account-error" }}
            message={mutation.message}
            summaryRef={mutation.errorSummaryRef}
          />
        ) : null}
        <FormSection
          title="Confirm deletion"
          description="Your email address becomes available for a new account afterwards."
        >
          <FormField
            errorId="delete-account-error"
            errors={errors}
            label="Type DELETE to confirm"
          >
            <input name="confirm" autoComplete="off" required />
          </FormField>
        </FormSection>
        <div className="form-actions">
          <button
            className="button--destructive"
            disabled={mutation.pending}
            ref={triggerRef}
            type="submit"
          >
            Delete account
          </button>
        </div>
        <ConfirmDialog
          cancelLabel="Keep account"
          confirmLabel="Permanently delete account"
          heading="Permanently delete your account?"
          onClose={() => setConfirming(false)}
          open={confirming}
          pending={mutation.pending}
          returnFocusRef={triggerRef}
        >
          <p>
            This cannot be undone. Your profile, followed schools, and RSVPs
            will be removed.
          </p>
          {mutation.message ? <p role="alert">{mutation.message}</p> : null}
        </ConfirmDialog>
      </form>
    </section>
  );
}

function AccountPending() {
  return <RoutePending message="Loading your account…" />;
}
function AccountError({ reset }: ErrorComponentProps) {
  return (
    <RouteErrorView
      reset={reset}
      eyebrow="Account unavailable"
      heading="We could not load your account."
    />
  );
}
