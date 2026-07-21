import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { EventForm } from "../../../../components/event-form";
import {
  ApiError,
  isLockedEvent,
  type School,
  type SchoolSummary
} from "../../../../lib/cgn-api";
import {
  currentProfile,
  getEvent,
  listGames,
  listSchools
} from "../../../../lib/server-api";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export default async function EditEventPage({ params }: PageProps) {
  const { slug } = await params;
  const profile = await currentProfile();

  if (!profile) {
    redirect(`/login?next=/events/${slug}/edit`);
  }

  const event = await getEvent(slug, { includeCookie: true }).catch((error) => {
    if (error instanceof ApiError && error.status === 404) {
      notFound();
    }

    throw error;
  });

  if (isLockedEvent(event)) {
    return (
      <main className="narrow">
        <section className="page-heading">
          <p className="eyebrow">Edit event</p>
          <h1>This private event is locked.</h1>
          <p className="lede">
            Only an event organizer can load private event details for editing.
          </p>
        </section>
        <Link className="button button--secondary" href={`/events/${slug}`}>
          Back to event
        </Link>
      </main>
    );
  }

  if (!event.viewer_can_edit) {
    return (
      <main className="narrow">
        <section className="page-heading">
          <p className="eyebrow">Edit event</p>
          <h1>You do not have permission to edit this event.</h1>
          <p className="lede">Only an event organizer can change or delete it.</p>
        </section>
        <Link className="button button--secondary" href={`/events/${slug}`}>
          Back to event
        </Link>
      </main>
    );
  }

  const [games, schoolsResult] = await Promise.all([
    listGames(),
    listSchools({ limit: 100 })
  ]);
  const schools = withSchoolSummary(schoolsResult.schools, event.host_school);

  return (
    <main className="narrow">
      <section className="page-heading">
        <p className="eyebrow">Edit event</p>
        <h1>{event.title}</h1>
        <p className="lede">
          Update the event details. Leave the private password blank to keep the
          current password.
        </p>
      </section>

      <EventForm event={event} games={games} mode="edit" schools={schools} />
    </main>
  );
}

function withSchoolSummary(schools: School[], summary: SchoolSummary) {
  if (schools.some((school) => school.id === summary.id)) {
    return schools;
  }

  return [
    {
      id: summary.id,
      name: summary.name,
      slug: summary.slug,
      city: summary.city,
      state: summary.state,
      is_main_campus: true,
      num_branches: 0
    },
    ...schools
  ];
}
