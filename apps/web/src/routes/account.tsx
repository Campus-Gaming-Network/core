import {
  Link,
  createFileRoute,
  redirect,
  type ErrorComponentProps
} from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { type FormEvent, type InputHTMLAttributes } from "react";
import {
  FieldError,
  fieldErrorProps,
  useEnhancedMutation
} from "../components/enhanced-mutation";
import {
  deleteAccount,
  getAccountDashboard,
  updateAccountProfile
} from "../features/account-slice/account.functions";
import { accountHead } from "../features/account-slice/presentation";
import {
  type AccountProfileDTO,
  type DashboardEventDTO
} from "../features/account-slice/contracts";
import {
  RouteErrorView,
  RoutePending
} from "../components/route-boundaries";
import {
  eventLifecycleLabel,
  eventRSVPLabel,
  eventTimeRange
} from "../features/event-slice/presentation";
import { schoolLocation } from "../features/school-slice/presentation";
import { teamRoleLabel } from "../features/team-slice/presentation";
import accountCSS from "../features/account-slice/account.css?url";

type AccountNotice =
  | "delete-failed"
  | "profile-failed"
  | "profile-updated";

export const Route = createFileRoute("/account")({
  validateSearch: (search: Record<string, unknown>) => {
    const value = Array.isArray(search.account)
      ? search.account[0]
      : search.account;
    return value === "delete-failed" ||
      value === "profile-failed" ||
      value === "profile-updated"
      ? { account: value as AccountNotice }
      : {};
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
    links: [{ rel: "stylesheet", href: accountCSS }]
  }),
  pendingComponent: AccountPending,
  errorComponent: AccountError,
  component: AccountPage
});

function AccountPage() {
  const data = Route.useLoaderData();
  const search = Route.useSearch();

  return (
    <main className="narrow">
      <section className="profile-hero">
        <AccountAvatar profile={data.profile} />
        <div>
          <p className="eyebrow">Account</p>
          <h1>{data.profile.name}</h1>
          <p className="lede">
            Your account dashboard for profile details, followed schools, and
            team activity.
          </p>
        </div>
      </section>

      {search.account ? <AccountNoticeView notice={search.account} /> : null}

      <section className="summary-strip" aria-label="Account summary">
        <article className="card"><strong>Email</strong>{data.profile.email}</article>
        <article className="card">
          <strong>Verification</strong>
          {data.profile.email_verified_at ? "Email verified" : "Email pending"}
        </article>
        <article className="card">
          <strong>Public profile</strong>
          <Link className="link" to="/users/$id" params={{ id: data.profile.id }}>
            View profile
          </Link>
        </article>
      </section>

      {!data.profile.email_verified_at ? (
        <p role="alert">Verify your email to unlock normal authenticated use.</p>
      ) : null}

      <DashboardEventSection
        heading="Upcoming RSVPs"
        id="upcoming-rsvps-title"
        empty="You have no upcoming yes or maybe RSVPs."
        events={data.dashboardEvents.upcoming_rsvps}
        variant="rsvp"
      />
      <DashboardEventSection
        heading="Followed-school events"
        id="followed-school-events-title"
        empty="No upcoming public events from followed schools yet."
        events={data.dashboardEvents.followed_school_events}
        variant="followed"
      />

      <section className="section" aria-labelledby="followed-schools-title">
        <div className="section-heading">
          <div><p className="eyebrow">Following</p><h2 id="followed-schools-title">Followed schools</h2></div>
          <Link className="link" to="/schools">Find schools</Link>
        </div>
        {data.followedSchools.length > 0 ? (
          <div className="list">
            {data.followedSchools.map((school) => (
              <Link className="card card--default list-item" key={school.id} to="/schools/$slug" params={{ slug: school.slug }}>
                <span><strong>{school.name}</strong><small>{schoolLocation(school)}</small></span>
              </Link>
            ))}
          </div>
        ) : <p className="empty-state">You are not following any additional schools yet.</p>}
      </section>

      <section className="section" aria-labelledby="team-activity-title">
        <div className="section-heading">
          <div><p className="eyebrow">Teams</p><h2 id="team-activity-title">Team activity</h2></div>
          <Link className="link" to="/teams">Find teams</Link>
        </div>
        {data.teams.length > 0 ? (
          <div className="list">
            {data.teams.map((team) => (
              <Link className="card card--default list-item" key={team.id} to="/teams/$slug" params={{ slug: team.slug }}>
                <span className="event-card-heading">
                  <strong>{team.name}</strong>
                  <small>{team.viewer_role ? teamRoleLabel(team.viewer_role) : "Member"} · {team.member_count} member{team.member_count === 1 ? "" : "s"}</small>
                </span>
                <small>{team.games.map((game) => game.name).join(", ")}</small>
                <small>{team.school?.name ?? "Independent team"}</small>
              </Link>
            ))}
          </div>
        ) : <p className="empty-state">You have not joined any teams yet. Join with a team password or create your first team.</p>}
      </section>

      <ProfileForm profile={data.profile} />
      <DeleteAccountForm />
    </main>
  );
}

function DashboardEventSection({
  heading,
  id,
  empty,
  events,
  variant
}: {
  heading: string;
  id: string;
  empty: string;
  events: DashboardEventDTO[];
  variant: "followed" | "rsvp";
}) {
  return (
    <section className="section" aria-labelledby={id}>
      <div className="section-heading">
        <div><p className="eyebrow">{variant === "rsvp" ? "Events" : "Following"}</p><h2 id={id}>{heading}</h2></div>
        <Link className="link" to="/events">Browse events</Link>
      </div>
      {events.length > 0 ? (
        <div className="list">
          {events.map((event) => (
            <Link className="card card--default list-item" key={event.id} to="/events/$slug" params={{ slug: event.slug }}>
              <span className="event-card-heading"><strong>{event.title}</strong><small>{eventTimeRange(event)}</small></span>
              <small>{variant === "rsvp" && event.viewer_rsvp ? `RSVP: ${eventRSVPLabel(event.viewer_rsvp)}` : eventLifecycleLabel(event.lifecycle)}</small>
              <small>{event.host_school.name} · {event.games.map((game) => game.name).join(", ")}</small>
            </Link>
          ))}
        </div>
      ) : <p className="empty-state">{empty}</p>}
    </section>
  );
}

function ProfileForm({ profile }: { profile: AccountProfileDTO }) {
  const runUpdate = useServerFn(updateAccountProfile);
  const mutation = useEnhancedMutation("We could not update your profile. Please try again.");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const socialLinks = [0, 1, 2].flatMap((index) => {
      const label = String(form.get(`social_label_${index}`) ?? "");
      const url = String(form.get(`social_url_${index}`) ?? "");
      return label || url ? [{ label, url }] : [];
    });
    await mutation.execute(() => runUpdate({ data: {
      name: String(form.get("name") ?? ""),
      bio: String(form.get("bio") ?? ""),
      timezone: String(form.get("timezone") ?? ""),
      social_links: socialLinks
    } }));
  }

  const socialLinks = profile.social_links ?? [];
  return (
    <section className="section" aria-labelledby="profile-settings-title">
      <h2 id="profile-settings-title">Profile settings</h2>
      <form action={updateAccountProfile.url} className="form-stack" method="post" onSubmit={submit}>
        {mutation.message ? <p role="alert" aria-live="polite">{mutation.message}</p> : null}
        <ProfileField label="Name" name="name" defaultValue={profile.name} required maxLength={120} errors={mutation.fieldErrors.name} />
        <label>Bio<textarea name="bio" defaultValue={profile.bio ?? ""} maxLength={2000} rows={5} {...fieldErrorProps(mutation.fieldErrors.bio, "profile-bio-error")} /><FieldError id="profile-bio-error" messages={mutation.fieldErrors.bio} /></label>
        <ProfileField label="Time zone" name="timezone" defaultValue={profile.timezone} required errors={mutation.fieldErrors.timezone} />
        <fieldset><legend>Social links</legend>
          {[0, 1, 2].map((index) => (
            <div className="split-fields" key={index}>
              <ProfileField aria-label={`Social link ${index + 1} label`} label="Label" name={`social_label_${index}`} defaultValue={socialLinks[index]?.label ?? ""} maxLength={40} errors={mutation.fieldErrors[`social_label_${index}`]} />
              <ProfileField aria-label={`Social link ${index + 1} URL`} label="URL" name={`social_url_${index}`} defaultValue={socialLinks[index]?.url ?? ""} maxLength={500} type="url" errors={mutation.fieldErrors[`social_url_${index}`]} />
            </div>
          ))}
        </fieldset>
        <button type="submit" disabled={mutation.pending}>{mutation.pending ? "Saving…" : "Save profile"}</button>
      </form>
    </section>
  );
}

function ProfileField({ label, name, errors, ...input }: { label: string; name: string; errors?: string[] } & Omit<InputHTMLAttributes<HTMLInputElement>, "name">) {
  const id = `profile-${name}-error`;
  return <label>{label}<input name={name} {...input} {...fieldErrorProps(errors, id)} /><FieldError id={id} messages={errors} /></label>;
}

function DeleteAccountForm() {
  const runDelete = useServerFn(deleteAccount);
  const mutation = useEnhancedMutation("We could not delete your account. Please try again.");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await mutation.execute(() => runDelete({ data: { confirm: String(form.get("confirm") ?? "") } }));
  }
  const errors = mutation.fieldErrors.confirm;
  return (
    <section className="action-panel" aria-labelledby="delete-account">
      <h2 id="delete-account">Delete your account</h2>
      <p>This removes your profile, followed schools, and RSVPs and cannot be undone. Published events remain available without a link to you, and team ownership passes according to the API policy.</p>
      <form action={deleteAccount.url} className="form-stack" method="post" onSubmit={submit}>
        {mutation.message ? <p role="alert" aria-live="polite">{mutation.message}</p> : null}
        <label>Type DELETE to confirm<input name="confirm" autoComplete="off" required {...fieldErrorProps(errors, "delete-account-error")} /><FieldError id="delete-account-error" messages={errors} /></label>
        <p className="form-help">Your email address becomes available for a new account afterwards.</p>
        <button type="submit" disabled={mutation.pending}>{mutation.pending ? "Deleting…" : "Delete account"}</button>
      </form>
    </section>
  );
}

function AccountAvatar({ profile }: { profile: AccountProfileDTO }) {
  const avatar = safeHTTPURL(profile.avatar_url);
  return avatar
    ? <img className="avatar avatar--large" src={avatar} alt="" />
    : <span className="avatar avatar--large" aria-hidden="true">{profile.name.trim().slice(0, 1).toUpperCase() || "C"}</span>;
}

function AccountNoticeView({ notice }: { notice: AccountNotice }) {
  const failed = notice.endsWith("failed");
  const message = notice === "profile-updated"
    ? "Profile updated."
    : notice === "profile-failed"
      ? "We could not update your profile. Please try again."
      : "We could not delete your account. Please try again.";
  return <p role={failed ? "alert" : "status"} aria-live="polite">{message}</p>;
}

function safeHTTPURL(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function AccountPending() { return <RoutePending message="Loading your account…" />; }
function AccountError({ reset }: ErrorComponentProps) {
  return <RouteErrorView reset={reset} eyebrow="Account unavailable" heading="We could not load your account." />;
}
