import { redirect } from "next/navigation";
import { EventForm } from "../../../components/event-form";
import { type School, type SchoolSummary } from "../../../lib/cgn-api";
import { currentProfile, listGames, listSchools } from "../../../lib/server-api";

export default async function NewEventPage() {
  const profile = await currentProfile();

  if (!profile) {
    redirect("/login?next=/events/new");
  }

  const [games, schoolsResult] = await Promise.all([
    listGames(),
    listSchools({ limit: 100 })
  ]);
  const schools = withHomeSchool(schoolsResult.schools, profile.home_school);

  return (
    <main className="narrow">
      <section className="page-heading">
        <p className="eyebrow">Create event</p>
        <h1>Create a campus gaming event</h1>
        <p className="lede">
          Start with the event basics. Private events can be password-unlocked,
          and yes RSVPs receive confirmation emails with calendar files.
        </p>
      </section>

      <EventForm
        defaultSchoolID={profile.home_school_id}
        games={games}
        mode="create"
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
