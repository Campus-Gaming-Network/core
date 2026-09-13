import {
  Link,
  createFileRoute,
  notFound,
  useRouter,
  type ErrorComponentProps
} from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { type FormEvent, useState } from "react";
import {
  FieldError,
  fieldErrorProps,
  useEnhancedMutation
} from "../components/enhanced-mutation";
import {
  RouteErrorView,
  RoutePending
} from "../components/route-boundaries";
import { getEventViewerSession } from "../features/event-slice/auth.functions";
import {
  validateTeamDetailSearch,
  type TeamDTO,
  type TeamMemberDTO,
  type TeamMutationResult,
  type TeamNotice,
  type TeamViewerState
} from "../features/team-slice/contracts";
import {
  getTeamDetail,
  joinTeam,
  setTeamCaptain,
  transferTeamOwnership
} from "../features/team-slice/team.functions";
import {
  teamHead,
  teamRoleLabel
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
      getEventViewerSession()
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
          ? detail.viewerRole ?? "non_member"
          : "anonymous",
      ...(detail.ownerRoster ? { ownerRoster: detail.ownerRoster } : {}),
      hasSessionCookie: detail.hasSessionCookie,
      publicOrigin: context.publicOrigin
    };
  },
  staleTime: 0,
  headers: ({ loaderData }) => ({
    "cache-control": loaderData?.hasSessionCookie
      ? "private, no-store"
      : "public, max-age=0, must-revalidate",
    vary: "Cookie"
  }),
  head: ({ loaderData }) => ({
    ...teamHead(loaderData?.team, loaderData?.publicOrigin),
    links: [{ rel: "stylesheet", href: teamCSS }]
  }),
  pendingComponent: TeamPending,
  errorComponent: TeamError,
  component: TeamPage
});

function TeamPage() {
  const { ownerRoster, team, viewer } = Route.useLoaderData();
  const search = Route.useSearch();

  return (
    <main className="narrow">
      <section className="page-heading">
        <p className="eyebrow">Team</p>
        <h1>{team.name}</h1>
        <p className="lede">
          {team.description || "Team details are coming soon."}
        </p>
        <div className="pill-list">
          <span>
            {team.member_count} member{team.member_count === 1 ? "" : "s"}
          </span>
          <span>{team.school?.name ?? "Independent team"}</span>
        </div>
      </section>

      {search.team ? <TeamNoticeMessage status={search.team} /> : null}

      <section className="detail-grid" aria-label="Team details">
        <div className="detail-row">
          <span>Games</span>
          <strong>{team.games.map((game) => game.name).join(", ")}</strong>
        </div>
        {team.school ? (
          <div className="detail-row">
            <span>School</span>
            <strong>
              <Link
                className="link"
                to="/schools/$slug"
                params={{ slug: team.school.slug }}
              >
                {team.school.name}
              </Link>
            </strong>
          </div>
        ) : null}
      </section>

      <section className="action-panel" aria-labelledby="team-actions">
        <h2 id="team-actions">Team actions</h2>
        <TeamActions
          ownerRoster={ownerRoster}
          slug={team.slug}
          viewer={viewer}
        />
      </section>
    </main>
  );
}

function TeamActions({
  ownerRoster,
  slug,
  viewer
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
        <Link
          className="button button--primary"
          to="/login"
          search={{ next: `/teams/${slug}` }}
        >
          Log in to join
        </Link>
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
    "We could not join that team. Please try again."
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await mutation.execute(() =>
      runJoinTeam({
        data: {
          slug,
          password: String(form.get("password") ?? "")
        }
      })
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
      {mutation.message ? (
        <p role="alert" aria-live="polite">
          {mutation.message}
        </p>
      ) : null}
      <label>
        Team password
        <input
          autoComplete="current-password"
          minLength={8}
          maxLength={200}
          name="password"
          required
          type="password"
          {...fieldErrorProps(passwordErrors, "team-join-password-error")}
        />
        <FieldError
          id="team-join-password-error"
          messages={passwordErrors}
        />
      </label>
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
  slug
}: {
  members: TeamMemberDTO[];
  slug: string;
}) {
  const manageableMembers = members.filter((member) => member.role !== "owner");

  return (
    <div className="form-stack team-management-panel">
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
  slug
}: {
  member: TeamMemberDTO;
  slug: string;
}) {
  const runSetTeamCaptain = useServerFn(setTeamCaptain);
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const isCaptain = member.role === "captain";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    let result: TeamMutationResult | undefined;
    try {
      result = await runSetTeamCaptain({
        data: {
          slug,
          user_id: member.user_id,
          captain: !isCaptain
        }
      });
    } catch {
      result = undefined;
    }
    await finishManagementMutation(router, result, slug);
    setPending(false);
  }

  return (
    <div className="card list-item team-management-row">
      <span>
        <strong>{member.name}</strong>
        <small>{teamRoleLabel(member.role)}</small>
      </span>
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
          type="submit"
        >
          {pending
            ? "Updating…"
            : isCaptain
              ? "Remove captain"
              : "Make captain"}
        </button>
      </form>
    </div>
  );
}

function TransferOwnershipForm({
  members,
  slug
}: {
  members: TeamMemberDTO[];
  slug: string;
}) {
  const runTransferTeamOwnership = useServerFn(transferTeamOwnership);
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    let result: TeamMutationResult | undefined;
    try {
      result = await runTransferTeamOwnership({
        data: {
          slug,
          new_owner_user_id: String(form.get("new_owner_user_id") ?? "")
        }
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
      <button disabled={pending} type="submit">
        {pending ? "Transferring…" : "Transfer ownership"}
      </button>
    </form>
  );
}

async function finishManagementMutation(
  router: ReturnType<typeof useRouter>,
  result: TeamMutationResult | undefined,
  slug: string
) {
  await router.invalidate();
  await router.navigate({
    href:
      result?.status === "success"
        ? result.redirectTo
        : `/teams/${encodeURIComponent(slug)}?team=manage-failed`,
    replace: true
  });
}

function TeamNoticeMessage({ status }: { status: TeamNotice }) {
  const messages: Record<TeamNotice, string> = {
    "captain-updated": "Captain role updated.",
    created: "Team created.",
    joined: "You joined the team.",
    "join-failed": "We could not join that team. Please try again.",
    "manage-failed": "We could not update team management. Please try again.",
    "ownership-transferred": "Ownership transferred."
  };
  return (
    <p
      role={
        status === "join-failed" || status === "manage-failed"
          ? "alert"
          : "status"
      }
      aria-live="polite"
    >
      {messages[status]}
    </p>
  );
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
