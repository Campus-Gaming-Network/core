import {
  Link,
  createFileRoute,
  redirect,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import type { FormEvent } from "react";
import {
  FormErrorSummary,
  useEnhancedMutation,
} from "../components/enhanced-mutation";
import { FormField, RequiredFieldsNote } from "../components/form-field";
import { FormSection } from "../components/form-section";
import { pageNoticeKey } from "../components/page-notice";
import { PageNoticeView } from "../components/page-notice-view";
import { RouteErrorView, RoutePending } from "../components/route-boundaries";
import {
  getAccountProfile,
  updateAccountProfile,
} from "../features/account-slice/account.functions";
import type { AccountProfileDTO } from "../features/account-slice/contracts";
import {
  settingsNotices,
  settingsProfileHead,
} from "../features/account-slice/presentation";

// The API accepts at most three social links; rows are numbered from zero.
const socialLinkSlots = [0, 1, 2];

export const Route = createFileRoute("/settings/profile")({
  validateSearch: (search: Record<string, unknown>) => {
    const settings = pageNoticeKey(settingsNotices, search.settings);
    return settings ? { settings } : {};
  },
  loader: async ({ context }) => {
    const result = await getAccountProfile();
    if (result.status === "unauthenticated") {
      throw redirect({
        to: "/login",
        search: { next: "/settings/profile" },
      });
    }
    if (result.status !== "found") {
      throw new Error("Account details are unavailable");
    }
    return { profile: result.profile, publicOrigin: context.publicOrigin };
  },
  staleTime: 0,
  headers: () => ({ "cache-control": "private, no-store", vary: "Cookie" }),
  head: ({ loaderData }) => settingsProfileHead(loaderData?.publicOrigin),
  pendingComponent: ProfilePending,
  errorComponent: ProfileError,
  component: SettingsProfilePage,
});

function SettingsProfilePage() {
  const { profile } = Route.useLoaderData();
  const search = Route.useSearch();

  return (
    <>
      <header className="section-heading">
        <h1>Edit profile</h1>
        <Link
          className="link"
          to="/users/$id"
          params={{ id: profile.id }}
        >
          View public profile
        </Link>
      </header>
      <PageNoticeView
        notice={search.settings ? settingsNotices[search.settings] : undefined}
      />
      <ProfileForm profile={profile} />
    </>
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
          discord_username: String(form.get("discord_username") ?? ""),
          // A "false" input comes before the checkbox, so the last value is
          // the checkbox when it is checked and the "false" when it is not.
          show_in_lists: form.getAll("show_in_lists").at(-1) === "true",
        },
      }),
    );
  }

  // The URL rows hold the URL links. A Discord username has its own field.
  const savedLinks = profile.social_links ?? [];
  const socialLinks = savedLinks.filter((link) => link.kind === "url");
  const discordLink = savedLinks.find((link) => link.kind === "discord");
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
        description="Optional. Link to your profiles elsewhere. You can add up to three, and a Discord username."
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
        <FormField
          errorId="profile-discord_username-error"
          errors={mutation.fieldErrors.discord_username}
          label="Discord username"
          optional
        >
          <input
            autoCapitalize="none"
            autoComplete="off"
            defaultValue={discordLink?.username ?? ""}
            maxLength={33}
            name="discord_username"
            spellCheck={false}
          />
        </FormField>
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
  );
}

function ProfilePending() {
  return <RoutePending message="Loading your profile…" />;
}

function ProfileError({ reset }: ErrorComponentProps) {
  return (
    <RouteErrorView
      reset={reset}
      eyebrow="Profile unavailable"
      heading="We could not load your profile."
    />
  );
}
