import {
  Link,
  createFileRoute,
  notFound,
  useRouter,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft } from "lucide-react";
import { type FormEvent, useRef, useState } from "react";
import { ButtonLink } from "../components/button-link";
import { ConfirmDialog } from "../components/confirm-dialog";
import {
  FormErrorSummary,
  useEnhancedMutation,
} from "../components/enhanced-mutation";
import { FormField } from "../components/form-field";
import { PageNoticeView } from "../components/page-notice-view";
import { Person } from "../components/person";
import { RouteErrorView, RoutePending } from "../components/route-boundaries";
import { getEventViewerSession } from "../features/event-slice/auth.functions";
import {
  validateTeamDetailSearch,
  type TeamDTO,
  type TeamMemberDTO,
  type TeamMutationResult,
  type TeamViewerState,
} from "../features/team-slice/contracts";
import {
  getTeamDetail,
  joinTeam,
  setTeamCaptain,
  transferTeamOwnership,
} from "../features/team-slice/team.functions";
import {
  teamDetailNotices,
  teamHead,
  teamRoleLabel,
} from "../features/team-slice/presentation";
import teamCSS from "../features/team-slice/teams.css?url";

export type TeamRouteData = {
  team: TeamDTO;
  viewer: TeamViewerState;
  ownerRoster?: TeamMemberDTO[];
  hasSessionCookie: boolean;
  publicOrigin: string;
};

export const Route = createFileRoute("/teams/$slug")({
  validateSearch: validateTeamDetailSearch,
  loader: async ({ context, params }): Promise<TeamRouteData> => {
    const [detail, session] = await Promise.all([
      getTeamDetail({ data: { slug: params.slug } }),
      getEventViewerSession(),
    ]);
    if (detail.status === "not_found") {
      throw notFound();
    }
    if (detail.status !== "found") {
      throw new Error("Team detail is unavailable");
    }
    if (session.status === "unavailable") {
      throw new Error("Team viewer session is unavailable");
    }

    return {
      team: detail.team,
      viewer:
        session.status === "authenticated"
          ? (detail.viewerRole ?? "non_member")
          : "anonymous",
      ...(detail.ownerRoster ? { ownerRoster: detail.ownerRoster } : {}),
      hasSessionCookie: detail.hasSessionCookie,
      publicOrigin: context.publicOrigin,
    };
  },
  staleTime: 0,
  headers: ({ loaderData }) => ({
    "cache-control": loaderData?.hasSessionCookie
      ? "private, no-store"
      : "public, max-age=0, must-revalidate",
    vary: "Cookie",
  }),
  head: ({ loaderData }) => ({
    ...teamHead(loaderData?.team, loaderData?.publicOrigin),
    links: [{ rel: "stylesheet", href: teamCSS }],
  }),
  pendingComponent: TeamPending,
  errorComponent: TeamError,
  component: TeamPage,
});

function TeamPage() {
  const { ownerRoster, team, viewer } = Route.useLoaderData();
  const search = Route.useSearch();

  return (
    <main className="detail-page">
      <Link className="back-link with-arrow" to="/teams">
        <ArrowLeft aria-hidden="true" size={14} strokeWidth={2.25} />
        Back to teams
      </Link>
      <header className="team-profile-header">
        <span aria-hidden="true" className="team-mark team-mark--large">
          {team.name.slice(0, 1).toUpperCase()}
        </span>
        <div>
          <p className="eyebrow">Team</p>
          <h1>{team.name}</h1>
          <p className="lede">
            {team.description || "Team details are coming soon."}
          </p>
        </div>
      </header>

      <PageNoticeView
        notice={search.team ? teamDetailNotices[search.team] : undefined}
      />

      <div className="team-detail-layout">
        <section className="detail-card" aria-labelledby="team-about">
          <h2 id="team-about">Team details</h2>
          <div className="detail-row">
            <span>Games</span>
            <strong>{team.games.map((game) => game.name).join(", ")}</strong>
          </div>
          <div className="detail-row">
            <span>School</span>
            <strong>
              {team.school ? (
                <Link
                  className="link"
                  to="/schools/$slug"
                  params={{ slug: team.school.slug }}
                >
                  {team.school.name}
                </Link>
              ) : (
                "Independent team"
              )}
            </strong>
          </div>
          <div className="detail-row">
            <span>Members</span>
            <strong>{team.member_count}</strong>
          </div>
        </section>

        <section
          className="action-panel team-action-panel"
          aria-labelledby="team-actions"
        >
          <p className="eyebrow">Membership</p>
          <h2 id="team-actions">Join and manage</h2>
          <TeamActions
            ownerRoster={ownerRoster}
            slug={team.slug}
            viewer={viewer}
          />
        </section>
      </div>
    </main>
  );
}

function TeamActions({
  ownerRoster,
  slug,
  viewer,
}: {
  ownerRoster?: TeamMemberDTO[];
  slug: string;
  viewer: TeamViewerState;
}) {
  if (viewer === "anonymous") {
    return (
      <>
        <p>
          Team pages are public, but joining requires logging in and entering
          the team password.
        </p>
        <ButtonLink
          variant="primary"
          to="/login"
          search={{ next: `/teams/${slug}` }}
        >
          Log in to join
        </ButtonLink>
      </>
    );
  }

  if (viewer === "non_member") {
    return <TeamJoinForm slug={slug} />;
  }

  return (
    <>
      <p role="status">Your role: {teamRoleLabel(viewer)}.</p>
      {viewer === "owner" ? (
        <TeamManagementPanel members={ownerRoster ?? []} slug={slug} />
      ) : (
        <p>
          Member interaction is enabled. Captains and owners manage team roles.
        </p>
      )}
    </>
  );
}

function TeamJoinForm({ slug }: { slug: string }) {
  const runJoinTeam = useServerFn(joinTeam);
  const mutation = useEnhancedMutation(
    "We could not join that team. Please try again.",
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await mutation.execute(() =>
      runJoinTeam({
        data: {
          slug,
          password: String(form.get("password") ?? ""),
        },
      }),
    );
  }

  const passwordErrors = mutation.fieldErrors.password;

  return (
    <form
      action={joinTeam.url}
      className="form-stack"
      method="post"
      onSubmit={submit}
    >
      <input name="slug" type="hidden" value={slug} />
      <FormErrorSummary
        fieldErrors={mutation.fieldErrors}
        fieldIds={{ password: "team-join-password-error" }}
        message={mutation.message}
        summaryRef={mutation.errorSummaryRef}
      />
      <FormField
        errorId="team-join-password-error"
        errors={passwordErrors}
        label="Team password"
      >
        <input
          autoComplete="current-password"
          minLength={8}
          maxLength={200}
          name="password"
          required
          type="password"
        />
      </FormField>
      <p className="form-help">
        Team pages are public. The password is checked only when you join.
      </p>
      <button disabled={mutation.pending} type="submit">
        {mutation.pending ? "Joining…" : "Join team"}
      </button>
    </form>
  );
}

function TeamManagementPanel({
  members,
  slug,
}: {
  members: TeamMemberDTO[];
  slug: string;
}) {
  const manageableMembers = members.filter((member) => member.role !== "owner");

  return (
    <div className="team-management-panel">
      <section
        className="team-management-section"
        aria-labelledby="captain-management"
      >
        <h3 id="captain-management">Captains</h3>
        <p className="form-help">
          Owners can add or remove captain status at any time.
        </p>
        {manageableMembers.length > 0 ? (
          <div className="list">
            {manageableMembers.map((member) => (
              <CaptainManagementRow
                key={member.user_id}
                member={member}
                slug={slug}
              />
            ))}
          </div>
        ) : (
          <p className="empty-state">
            Members will appear here after they join with the team password.
          </p>
        )}
      </section>

      <section
        className="team-management-section"
        aria-labelledby="ownership-transfer"
      >
        <h3 id="ownership-transfer">Transfer ownership</h3>
        {manageableMembers.length > 0 ? (
          <TransferOwnershipForm members={manageableMembers} slug={slug} />
        ) : (
          <p className="empty-state">
            Add another member before transferring ownership.
          </p>
        )}
      </section>
    </div>
  );
}

function CaptainManagementRow({
  member,
  slug,
}: {
  member: TeamMemberDTO;
  slug: string;
}) {
  const runSetTeamCaptain = useServerFn(setTeamCaptain);
  const router = useRouter();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const isCaptain = member.role === "captain";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isCaptain && !confirming) {
      setConfirming(true);
      return;
    }
    setPending(true);
    let result: TeamMutationResult | undefined;
    try {
      result = await runSetTeamCaptain({
        data: {
          slug,
          user_id: member.user_id,
          captain: !isCaptain,
        },
      });
    } catch {
      result = undefined;
    }
    await finishManagementMutation(router, result, slug);
    setPending(false);
  }

  return (
    <div className="card list-item team-management-row">
      <Person
        detail={teamRoleLabel(member.role)}
        id={member.user_id}
        name={member.name}
      />
      <form action={setTeamCaptain.url} method="post" onSubmit={submit}>
        <input name="slug" type="hidden" value={slug} />
        <input name="user_id" type="hidden" value={member.user_id} />
        <input
          name="captain"
          type="hidden"
          value={isCaptain ? "false" : "true"}
        />
        <button
          aria-label={`${isCaptain ? "Remove captain" : "Make captain"} ${member.name}`}
          disabled={pending}
          ref={triggerRef}
          type="submit"
        >
          {pending
            ? "Updating…"
            : isCaptain
              ? "Remove captain"
              : "Make captain"}
        </button>
        <ConfirmDialog
          cancelLabel="Keep captain"
          confirmLabel="Remove captain"
          heading={`Remove ${member.name} as captain?`}
          onClose={() => setConfirming(false)}
          open={confirming}
          pending={pending}
          returnFocusRef={triggerRef}
        >
          <p>
            They will remain a team member but will lose captain permissions.
          </p>
        </ConfirmDialog>
      </form>
    </div>
  );
}

function TransferOwnershipForm({
  members,
  slug,
}: {
  members: TeamMemberDTO[];
  slug: string;
}) {
  const runTransferTeamOwnership = useServerFn(transferTeamOwnership);
  const router = useRouter();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [confirming, setConfirming] = useState(false);
  const [selectedOwnerName, setSelectedOwnerName] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (!confirming) {
      const selectedID = String(form.get("new_owner_user_id") ?? "");
      setSelectedOwnerName(
        members.find((member) => member.user_id === selectedID)?.name ??
          "this member",
      );
      setConfirming(true);
      return;
    }
    setPending(true);
    let result: TeamMutationResult | undefined;
    try {
      result = await runTransferTeamOwnership({
        data: {
          slug,
          new_owner_user_id: String(form.get("new_owner_user_id") ?? ""),
        },
      });
    } catch {
      result = undefined;
    }
    await finishManagementMutation(router, result, slug);
    setPending(false);
  }

  return (
    <form
      action={transferTeamOwnership.url}
      className="form-stack"
      method="post"
      onSubmit={submit}
    >
      <input name="slug" type="hidden" value={slug} />
      <label>
        New owner
        <select
          defaultValue={members[0]?.user_id}
          name="new_owner_user_id"
          required
        >
          {members.map((member) => (
            <option key={member.user_id} value={member.user_id}>
              {member.name} · {teamRoleLabel(member.role)}
            </option>
          ))}
        </select>
      </label>
      <p className="form-help">
        Ownership transfer is immediate. You will remain a member after the
        transfer.
      </p>
      <button
        className="button--destructive"
        disabled={pending}
        ref={triggerRef}
        type="submit"
      >
        Transfer ownership
      </button>
      <ConfirmDialog
        cancelLabel="Keep ownership"
        confirmLabel="Yes, transfer ownership"
        heading={`Transfer ownership to ${selectedOwnerName}?`}
        onClose={() => setConfirming(false)}
        open={confirming}
        pending={pending}
        returnFocusRef={triggerRef}
      >
        <p>
          The transfer is immediate. You will remain a member, but the new owner
          will control team roles and future ownership transfers.
        </p>
      </ConfirmDialog>
    </form>
  );
}

async function finishManagementMutation(
  router: ReturnType<typeof useRouter>,
  result: TeamMutationResult | undefined,
  slug: string,
) {
  await router.invalidate();
  await router.navigate({
    href:
      result?.status === "success"
        ? result.redirectTo
        : `/teams/${encodeURIComponent(slug)}?team=manage-failed`,
    replace: true,
  });
}

function TeamPending() {
  return <RoutePending message="Loading team…" />;
}

function TeamError({ reset }: ErrorComponentProps) {
  return (
    <RouteErrorView
      reset={reset}
      eyebrow="Team unavailable"
      heading="We could not load this team."
    />
  );
}
