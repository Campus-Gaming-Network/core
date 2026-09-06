import { redirect } from "next/navigation";
import { EventForm } from "../../../components/event-form";
import { NoScriptSchoolSearch } from "../../../components/school-picker";
import { currentProfile, listGames, listSchools } from "../../../lib/server-api";
import { pageMetadata } from "../../../lib/metadata";

export const metadata = pageMetadata({
  title: "Create event",
  description:
    "Create a new campus gaming event.",
  path: "/events/new",
  noIndex: true
});

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function NewEventPage({ searchParams }: PageProps) {
  const profile = await currentProfile();

  if (!profile) {
    redirect("/login?next=/events/new");
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
        <p className="eyebrow">Create event</p>
        <h1>Create a campus gaming event</h1>
        <p className="lede">
          Start with the event basics. Private events can be password-unlocked,
          and yes RSVPs receive confirmation emails with calendar files.
        </p>
      </section>

      <NoScriptSchoolSearch
        action="/events/new"
        query={query}
      />
      <EventForm
        defaultSchoolID={profile.home_school_id}
        defaultSchool={profile.home_school}
        defaultTimeZone={profile.timezone}
        games={games}
        initialSchoolQuery={query}
        initialSchoolSearchFailed={schoolsResult.failed}
        mode="create"
        schools={schoolsResult.schools}
      />
    </main>
  );
}

function param(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}
