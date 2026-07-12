import Link from "next/link";
import { notFound } from "next/navigation";
import { TeamJoinForm } from "../../../components/team-join-form";
import { TeamManagementPanel } from "../../../components/team-management-panel";
import { ApiError, teamRoleLabel } from "../../../lib/cgn-api";
import { currentProfile, getTeam } from "../../../lib/server-api";

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function TeamDetailPage({
  params,
  searchParams
}: PageProps) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const [profile, team] = await Promise.all([
    currentProfile(),
    getTeam(slug, { includeCookie: true }).catch((error) => {
      if (error instanceof ApiError && error.status === 404) {
        notFound();
      }

      throw error;
    })
  ]);
  const notice = param(query.team);

  return (
    <main className="narrow">
      <section className="page-heading">
        <p className="eyebrow">Team</p>
        <h1>{team.name}</h1>
        <p className="lede">{team.description || "Team details are coming soon."}</p>
        <div className="pill-list">
          <span>{team.member_count} member{team.member_count === 1 ? "" : "s"}</span>
          <span>{team.school?.name ?? "Independent team"}</span>
        </div>
      </section>

      {notice ? <TeamNotice status={notice} /> : null}

      <section className="detail-grid" aria-label="Team details">
        <div className="detail-row">
          <span>Games</span>
          <strong>{team.games.map((game) => game.name).join(", ")}</strong>
        </div>
        {team.school ? (
          <div className="detail-row">
            <span>School</span>
            <strong>
              <Link href={`/schools/${team.school.slug}`}>
                {team.school.name}
              </Link>
            </strong>
          </div>
        ) : null}
      </section>

      <section className="action-panel" aria-labelledby="team-actions">
        <h2 id="team-actions">Team actions</h2>
        {team.viewer_role ? (
          <>
            <p className="notice success">
              Your role: {teamRoleLabel(team.viewer_role)}.
            </p>
            {team.viewer_role === "owner" ? (
              <TeamManagementPanel team={team} />
            ) : (
              <p>
                Member interaction is enabled. Captains and owners can manage
                team roles.
              </p>
            )}
          </>
        ) : profile ? (
          <TeamJoinForm slug={team.slug} />
        ) : (
          <>
            <p>
              Team pages are public, but joining and member interactions require
              logging in and entering the team password.
            </p>
            <div className="actions">
              <Link className="button primary" href={`/login?next=/teams/${team.slug}`}>
                Log in to join
              </Link>
            </div>
          </>
        )}
      </section>
    </main>
  );
}

function TeamNotice({ status }: { status: string }) {
  const messages: Record<string, string> = {
    "captain-updated": "Captain role updated.",
    created: "Team created.",
    joined: "You joined the team.",
    "manage-failed": "We could not update team management. Please try again.",
    "ownership-transferred": "Ownership transferred."
  };

  return (
    <p className={`notice ${status === "manage-failed" ? "error" : "success"}`}>
      {messages[status] ?? ""}
    </p>
  );
}

function param(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}
