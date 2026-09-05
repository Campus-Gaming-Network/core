import { redirect } from "next/navigation";
import { TeamForm } from "../../../components/team-form";
import { NoScriptSchoolSearch } from "../../../components/school-picker";
import { currentProfile, listGames, listSchools } from "../../../lib/server-api";
import { pageMetadata } from "../../../lib/metadata";

export const metadata = pageMetadata({
  title: "Start a team",
  description:
    "Start a new collegiate gaming team.",
  path: "/teams/new",
  noIndex: true
});

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function NewTeamPage({ searchParams }: PageProps) {
  const profile = await currentProfile();

  if (!profile) {
    redirect("/login?next=/teams/new");
  }

  const query = param((await searchParams).school_q);
  const schoolsPromise = query.trim().length >= 2
    ? listSchools({ query, limit: 50 })
        .then(({ schools }) => ({ schools, failed: false }))
        .catch(() => ({ schools: [], failed: true }))
    : Promise.resolve({ schools: [], failed: false });
  const [games, schoolsResult] = await Promise.all([
    listGames(),
    schoolsPromise
  ]);

  return (
    <main className="narrow">
      <section className="page-heading">
        <p className="eyebrow">Create team</p>
        <h1>Create a campus gaming team</h1>
        <p className="lede">
          Start with public team details. The join password will be used for
          member access after the team is created.
        </p>
      </section>

      <NoScriptSchoolSearch action="/teams/new" query={query} />
      <TeamForm
        defaultSchoolID={profile.home_school_id}
        defaultSchool={profile.home_school}
        games={games}
        initialSchoolQuery={query}
        initialSchoolSearchFailed={schoolsResult.failed}
        schools={schoolsResult.schools}
      />
    </main>
  );
}

function param(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}
