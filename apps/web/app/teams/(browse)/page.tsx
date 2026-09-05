import { Button } from "@heroui/react/button";
import { EmptyState } from "@heroui/react/empty-state";
import { Input } from "@heroui/react/input";
import { ListBox } from "@heroui/react/list-box";
import { Select } from "@heroui/react/select";
import Link from "next/link";
import { Icon, appIcon } from "../../../components/icon";
import { currentProfile, listGames, listTeams } from "../../../lib/server-api";
import { pageMetadata } from "../../../lib/metadata";

export const metadata = pageMetadata({
  title: "Teams",
  description:
    "Browse collegiate gaming teams and find one to join on your campus.",
  path: "/teams"
});

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function TeamsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const game = param(params.game);
  const school = param(params.school);
  const [profile, games, result] = await Promise.all([
    currentProfile(),
    listGames().catch(() => []),
    listTeams({ game, school, limit: 25 }).catch(() => ({
      teams: [],
      limit: 25,
      offset: 0
    }))
  ]);

  return (
    <main className="narrow">
      <section className="page-heading">
        <p className="eyebrow">Teams</p>
        <h1>Find campus gaming teams</h1>
        <p className="lede">
          Team pages are public. Join with a team password, then owners can
          assign captains or transfer ownership.
        </p>
        <div className="actions">
          {profile ? (
            <Link className="button button--primary" href="/teams/new">
              <Icon icon={appIcon.create} />
              Create team
            </Link>
          ) : (
            <Link className="button button--primary" href="/login?next=/teams/new">
              <Icon icon={appIcon.logIn} />
              Log in to create
            </Link>
          )}
        </div>
      </section>

      <form action="/teams" className="search-bar">
        <label>
          Game
          <Select
            fullWidth
            name="game"
            defaultSelectedKey={game}
            aria-label="Filter teams by game"
          >
            <Select.Trigger>
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                <ListBox.Item id="" textValue="All games">All games</ListBox.Item>
                {games.map((gameOption) => (
                  <ListBox.Item
                    id={gameOption.slug}
                    key={gameOption.id}
                    textValue={gameOption.name}
                  >
                    {gameOption.name}
                  </ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>
        </label>
        <label>
          School slug
          <Input
            name="school"
            defaultValue={school}
            placeholder="university-of-california-irvine"
          />
        </label>
        <Button type="submit">
          <Icon icon={appIcon.filter} />
          Filter
        </Button>
      </form>

      {result.teams.length > 0 ? (
        <div className="list">
          {result.teams.map((team) => (
            <Link className="card card--default list-item block" href={`/teams/${team.slug}`} key={team.id}>
              <span className="event-card-heading">
                <strong>{team.name}</strong>
                <small>{team.member_count} member{team.member_count === 1 ? "" : "s"}</small>
              </span>
              <small className="icon-text">
                <Icon icon={appIcon.game} size="sm" />
                {team.games.map((teamGame) => teamGame.name).join(", ")}
              </small>
              <small className="icon-text">
                <Icon icon={appIcon.school} size="sm" />
                {team.school?.name ?? "Independent team"}
              </small>
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState>
          <span className="icon-badge">
            <Icon icon={appIcon.notFound} size="xl" />
          </span>
          <h2>No teams found</h2>
          <p>
            Try clearing filters or create the first team for your campus.
          </p>
        </EmptyState>
      )}
    </main>
  );
}

function param(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}
