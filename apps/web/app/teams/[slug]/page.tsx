import { Alert } from "@heroui/react/alert";
import { Card } from "@heroui/react/card";
import { Chip } from "@heroui/react/chip";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TeamJoinForm } from "../../../components/team-join-form";
import { TeamManagementPanel } from "../../../components/team-management-panel";
import { ApiError, teamRoleLabel } from "../../../lib/cgn-api";
import { pageMetadata } from "../../../lib/metadata";
import { currentProfile, getTeam } from "../../../lib/server-api";

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({
  params
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const team = await getTeam(slug).catch(() => null);

  if (!team) {
    return pageMetadata({
      title: "Team not found",
      description: "This team is unavailable.",
      noIndex: true
    });
  }

  return pageMetadata({
    title: team.name,
    description:
      team.description ||
      `A collegiate gaming team at ${team.school?.name ?? "Campus Gaming Network"}.`,
    path: `/teams/${team.slug}`
  });
}

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
          <Chip>{team.member_count} member{team.member_count === 1 ? "" : "s"}</Chip>
          <Chip>{team.school?.name ?? "Independent team"}</Chip>
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
              <Link className="link" href={`/schools/${team.school.slug}`}>
                {team.school.name}
              </Link>
            </strong>
          </div>
        ) : null}
      </section>

      <Card className="action-panel" aria-labelledby="team-actions">
        <h2 id="team-actions">Team actions</h2>
        {team.viewer_role ? (
          <>
            <Alert status="success">
              Your role: {teamRoleLabel(team.viewer_role)}.
            </Alert>
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
              <Link className="button button--primary" href={`/login?next=/teams/${team.slug}`}>
                Log in to join
              </Link>
            </div>
          </>
        )}
      </Card>
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
    <Alert
      status={status === "manage-failed" ? "danger" : "success"}
    >
      {messages[status] ?? ""}
    </Alert>
  );
}

function param(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}
