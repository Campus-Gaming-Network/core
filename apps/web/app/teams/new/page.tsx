import { redirect } from "next/navigation";
import { TeamForm } from "../../../components/team-form";
import { type School, type SchoolSummary } from "../../../lib/cgn-api";
import { currentProfile, listGames, listSchools } from "../../../lib/server-api";

export default async function NewTeamPage() {
  const profile = await currentProfile();

  if (!profile) {
    redirect("/login?next=/teams/new");
  }

  const [games, schoolsResult] = await Promise.all([
    listGames(),
    listSchools({ limit: 100 })
  ]);
  const schools = withHomeSchool(schoolsResult.schools, profile.home_school);

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

      <TeamForm
        defaultSchoolID={profile.home_school_id}
        games={games}
        schools={schools}
      />
    </main>
  );
}

function withHomeSchool(schools: School[], homeSchool?: SchoolSummary) {
  if (!homeSchool) {
    return schools;
  }
  if (schools.some((school) => school.id === homeSchool.id)) {
    return schools;
  }

  return [
    {
      id: homeSchool.id,
      name: homeSchool.name,
      slug: homeSchool.slug,
      city: homeSchool.city,
      state: homeSchool.state,
      is_main_campus: true,
      num_branches: 0
    },
    ...schools
  ];
}
