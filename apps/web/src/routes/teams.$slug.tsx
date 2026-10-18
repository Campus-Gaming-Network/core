import {
  Link,
  createFileRoute,
  notFound,
  useRouter,
} from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight } from "lucide-react";
import { type FormEvent, useRef, useState } from "react";
import { BreadcrumbLink, Breadcrumbs } from "../components/breadcrumbs";
import { ButtonLink } from "../components/button-link";
import { DetailHero } from "../components/detail-hero";
import { StatusLabel } from "../components/status-label";
import { TabLink, Tabs } from "../components/tabs";
import { ConfirmDialog } from "../components/confirm-dialog";
import {
  FormErrorSummary,
  useEnhancedMutation,
} from "../components/enhanced-mutation";
import { FormField } from "../components/form-field";
import { PasswordInput } from "../components/password-input";
import { PageNoticeView } from "../components/page-notice-view";
import { Person } from "../components/person";
import {
  RecordNotFound,
  RouteErrorView,
  RoutePending,
} from "../components/route-boundaries";
import { getEventViewerSession } from "../features/event-slice/auth.functions";
import {
  peoplePreviewSize,
  type PeopleListResult,
} from "../features/people-slice/contracts";
import { EventCard } from "../features/event-slice/event-card";
import { getTeamEvents } from "../features/event-slice/event.functions";
import { getTeamMembers } from "../features/people-slice/people.functions";
import {
  PeoplePreview,
  PeopleSignedOut,
} from "../features/people-slice/people-views";
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
  leaveTeam,
  removeTeamMember,
  setTeamCaptain,
  transferTeamOwnership,
} from "../features/team-slice/team.functions";
import {
  teamDetailNotices,
  teamHead,
  teamRoleLabel,
} from "../features/team-slice/presentation";
import { schoolLocation } from "../features/school-slice/presentation";
import teamCSS from "../features/team-slice/teams.css?url";

type TeamRouteData = {
  team: TeamDTO;
  /** The public events the team hosts that have not ended. */
  events: Awaited<ReturnType<typeof getTeamEvents>>;
  viewer: TeamViewerState;
  ownerRoster?: TeamMemberDTO[];
  /** The first members; a visitor's read is a signed-out result. */
  members: PeopleListResult;
  hasSessionCookie: boolean;
  publicOrigin: string;
};

export const Route = createFileRoute("/teams/$slug")({
  validateSearch: validateTeamDetailSearch,
  loader: async ({ context, params }): Promise<TeamRouteData> => {
    const [detail, session, members, events] = await Promise.all([
      getTeamDetail({ data: { slug: params.slug } }),
      getEventViewerSession(),
      // A request with no session never reaches the API.
      getTeamMembers({
        data: { slug: params.slug, limit: peoplePreviewSize },
      }),
      getTeamEvents({ data: { slug: params.slug } }),
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
      events,
      viewer:
        session.status === "authenticated"
          ? (detail.viewerRole ?? "non_member")
          : "anonymous",
      ...(detail.ownerRoster ? { ownerRoster: detail.ownerRoster } : {}),
      members,
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
  head: ({ loaderData }) => {
    // Without loader data the page is a not-found or error view, which sets
    // its own title and robots.
    if (!loaderData) return { links: [{ rel: "stylesheet", href: teamCSS }] };
    const head = teamHead(loaderData.team, loaderData.publicOrigin);
    return {
      ...head,
      links: [...head.links, { rel: "stylesheet", href: teamCSS }],
    };
  },
  pendingComponent: TeamPending,
  errorComponent: TeamError,
  notFoundComponent: () => <RecordNotFound kind="team" />,
  component: TeamPage,
});

function TeamPage() {
  const { events, members, ownerRoster, team, viewer } = Route.useLoaderData();
  const search = Route.useSearch();
  const location = team.school ? schoolLocation(team.school, "") : "";

  return (
    <main className="team-page">
      <Breadcrumbs current={team.name}>
        <BreadcrumbLink to="/teams">Teams</BreadcrumbLink>
      </Breadcrumbs>
      <DetailHero initial={team.name}>
        <h1>{team.name}</h1>
        <p className="detail-hero__meta">
          {team.school ? (
            <>
              <Link to="/schools/$slug" params={{ slug: team.school.slug }}>
                {team.school.name}
              </Link>
              {location ? ` · ${location}` : null}
            </>
          ) : (
            "Independent team"
          )}
        </p>
        {team.games.length > 0 ? (
          <div className="tag-list" aria-label="Games">
            {team.games.map((game) => (
              <StatusLabel key={game.id}>{game.name}</StatusLabel>
            ))}
          </div>
        ) : null}
      </DetailHero>

      <Tabs label="Team sections">
        <TabLink current to="/teams/$slug" params={{ slug: team.slug }}>
          Overview
        </TabLink>
        <TabLink
          current={false}
          to="/teams/$slug/people"
          params={{ slug: team.slug }}
        >
          {`Members (${team.member_count})`}
        </TabLink>
      </Tabs>

      <PageNoticeView
        notice={search.team ? teamDetailNotices[search.team] : undefined}
      />

      <div className="layout-detail">
        <div className="layout-detail__main">
          <section className="team-about" aria-labelledby="team-about-title">
            <h2 id="team-about-title">About</h2>
            <p>{team.description || "Team details are coming soon."}</p>
          </section>

          <section
            aria-labelledby="team-events-title"
            className="panel panel--flush"
          >
            <div className="panel__header">
              <h2 id="team-events-title">Upcoming events</h2>
            </div>
            {events.unavailable ? (
              <p className="panel__body muted">
                Events are unavailable right now. Please check back soon.
              </p>
            ) : events.events.length > 0 ? (
              <div className="list directory-list">
                {events.events.map((event) => (
                  <EventCard event={event} key={event.id} showTeam={false} />
                ))}
              </div>
            ) : (
              <p className="panel__body muted">
                {team.name} has no upcoming public events.
              </p>
            )}
          </section>

          {viewer === "anonymous" ? (
            <PeopleSignedOut
              message="Log in to see the members of this team."
              next={`/teams/${team.slug}`}
            />
          ) : (
            <section
              className="detail-card"
              aria-labelledby="team-people-title"
            >
              <h2 id="team-people-title">Members</h2>
              <PeoplePreview empty="No members yet." result={members} />
              {members.status === "found" && members.list.people.length > 0 ? (
                <div className="detail-card-body">
                  <Link
                    aria-label={`See everyone on ${team.name}`}
                    className="link with-arrow"
                    to="/teams/$slug/people"
                    params={{ slug: team.slug }}
                  >
                    See everyone
                    <ArrowRight
                      aria-hidden="true"
                      size={14}
                      strokeWidth={2.25}
                    />
                  </Link>
                </div>
              ) : null}
            </section>
          )}

          {viewer === "owner" ? (
            <section
              className="panel team-manage"
              aria-labelledby="team-actions"
            >
              <h2 id="team-actions">Manage team</h2>
              <TeamManagementPanel
                members={ownerRoster ?? []}
                slug={team.slug}
              />
            </section>
          ) : null}
        </div>

        <aside className="layout-detail__aside" aria-label="Membership">
          <section className="team-header__actions panel">
            <TeamActions slug={team.slug} viewer={viewer} />
          </section>
        </aside>
      </div>
    </main>
  );
}

/** The page header's primary action: join, log in to join, or your role. */
function TeamActions({
  slug,
  viewer,
}: {
  slug: string;
  viewer: TeamViewerState;
}) {
  if (viewer === "anonymous") {
    return (
      <>
        <h2 className="team-panel__title">Join this team</h2>
        <p className="form-help">
          Joining requires logging in and entering the team password.
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
      <h2 className="team-panel__title">Your membership</h2>
      <p className="team-role">
        <span>Your role</span>
        <StatusLabel tone="info">{teamRoleLabel(viewer)}</StatusLabel>
      </p>
      {viewer === "owner" ? (
        <p className="form-help">
          You can manage members, captains, and ownership below. To leave the
          team, transfer ownership to another member first.
        </p>
      ) : (
        <LeaveTeamForm slug={slug} />
      )}
    </>
  );
}

/** Ends the viewer's own membership after they confirm. */
function LeaveTeamForm({ slug }: { slug: string }) {
  const runLeaveTeam = useServerFn(leaveTeam);
  const router = useRouter();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setPending(true);
    let result: TeamMutationResult | undefined;
    try {
      result = await runLeaveTeam({ data: { slug } });
    } catch {
      result = undefined;
    }
    await finishTeamMutation(router, result, slug, "leave-failed");
    setPending(false);
  }

  return (
    <form action={leaveTeam.url} method="post" onSubmit={submit}>
      <input name="slug" type="hidden" value={slug} />
      <button
        className="button--secondary"
        disabled={pending}
        ref={triggerRef}
        type="submit"
      >
        {pending ? "Leaving…" : "Leave team"}
      </button>
      <ConfirmDialog
        cancelLabel="Stay on the team"
        confirmLabel="Leave team"
        heading="Leave this team?"
        onClose={() => setConfirming(false)}
        open={confirming}
        pending={pending}
        returnFocusRef={triggerRef}
      >
        <p>
          You will come off the roster and lose any captain role. You can rejoin
          later with the team password.
        </p>
      </ConfirmDialog>
    </form>
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
      className="team-join-form"
      method="post"
      onSubmit={submit}
    >
      <input name="slug" type="hidden" value={slug} />
      <h2 className="team-panel__title">Join this team</h2>
      <p className="form-help">
        Team pages are public. The password is checked only when you join.
      </p>
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
        <PasswordInput
          autoComplete="current-password"
          minLength={8}
          maxLength={200}
          name="password"
          required
        />
      </FormField>
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
        <h3 id="captain-management">Members and captains</h3>
        <p className="form-help">
          Owners can make or remove captains and remove members at any time. A
          removed member can rejoin with the team password.
        </p>
        {manageableMembers.length > 0 ? (
          <ul className="team-management-list">
            {manageableMembers.map((member) => (
              <CaptainManagementRow
                key={member.user_id}
                member={member}
                slug={slug}
              />
            ))}
          </ul>
        ) : (
          <p className="form-help">
            Members will appear here after they join with the team password.
          </p>
        )}
      </section>

      <section
        className="team-management-section team-management-section--danger"
        aria-labelledby="ownership-transfer"
      >
        <h3 id="ownership-transfer">Transfer ownership</h3>
        {manageableMembers.length > 0 ? (
          <TransferOwnershipForm members={manageableMembers} slug={slug} />
        ) : (
          <p className="form-help">
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
    await finishTeamMutation(router, result, slug, "manage-failed");
    setPending(false);
  }

  return (
    <li className="team-management-row">
      <Person
        detail={teamRoleLabel(member.role)}
        id={member.user_id}
        name={member.name}
      />
      <div className="team-management-row__actions">
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
            className="button--secondary button--small"
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
        <RemoveMemberForm member={member} slug={slug} />
      </div>
    </li>
  );
}

/** Lets the owner take a member off the roster after confirming. */
function RemoveMemberForm({
  member,
  slug,
}: {
  member: TeamMemberDTO;
  slug: string;
}) {
  const runRemoveTeamMember = useServerFn(removeTeamMember);
  const router = useRouter();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setPending(true);
    let result: TeamMutationResult | undefined;
    try {
      result = await runRemoveTeamMember({
        data: { slug, user_id: member.user_id },
      });
    } catch {
      result = undefined;
    }
    await finishTeamMutation(router, result, slug, "manage-failed");
    setPending(false);
  }

  return (
    <form action={removeTeamMember.url} method="post" onSubmit={submit}>
      <input name="slug" type="hidden" value={slug} />
      <input name="user_id" type="hidden" value={member.user_id} />
      <button
        aria-label={`Remove ${member.name} from the team`}
        className="button--secondary button--small"
        disabled={pending}
        ref={triggerRef}
        type="submit"
      >
        {pending ? "Removing…" : "Remove"}
      </button>
      <ConfirmDialog
        cancelLabel="Keep member"
        confirmLabel="Remove member"
        heading={`Remove ${member.name} from the team?`}
        onClose={() => setConfirming(false)}
        open={confirming}
        pending={pending}
        returnFocusRef={triggerRef}
      >
        <p>
          They will come off the roster and lose any captain role. They can
          rejoin with the team password.
        </p>
      </ConfirmDialog>
    </form>
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
    await finishTeamMutation(router, result, slug, "manage-failed");
    setPending(false);
  }

  return (
    <form
      action={transferTeamOwnership.url}
      className="team-transfer-form"
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

async function finishTeamMutation(
  router: ReturnType<typeof useRouter>,
  result: TeamMutationResult | undefined,
  slug: string,
  failure: "manage-failed" | "leave-failed",
) {
  await router.invalidate();
  await router.navigate({
    href:
      result?.status === "success"
        ? result.redirectTo
        : `/teams/${encodeURIComponent(slug)}?team=${failure}`,
    replace: true,
  });
}

function TeamPending() {
  return <RoutePending message="Loading team…" />;
}

function TeamError() {
  return (
    <RouteErrorView
      eyebrow="Team unavailable"
      heading="We could not load this team."
    />
  );
}
