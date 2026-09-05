import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { EventForm } from "../../../../components/event-form";
import { NoScriptSchoolSearch } from "../../../../components/school-picker";
import {
  ApiError,
  isLockedEvent
} from "../../../../lib/cgn-api";
import { pageMetadata } from "../../../../lib/metadata";
import {
  currentProfile,
  getEvent,
  listGames,
  listSchools
} from "../../../../lib/server-api";

// Organizer-only page. Kept generic so an event title never reaches the head
// of a route that only organizers may open.
export const metadata = pageMetadata({
  title: "Edit event",
  description: "Edit your campus gaming event.",
  noIndex: true
});

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function EditEventPage({ params, searchParams }: PageProps) {
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
        <p className="eyebrow">Edit event</p>
        <h1>{event.title}</h1>
        <p className="lede">
          Update the event details. Leave the private password blank to keep the
          current password.
        </p>
      </section>

      <NoScriptSchoolSearch
        action={`/events/${slug}/edit`}
        query={query}
      />
      <EventForm
        event={event}
        games={games}
        initialSchoolQuery={query}
        initialSchoolSearchFailed={schoolsResult.failed}
        mode="edit"
        schools={schoolsResult.schools}
      />
    </main>
  );
}

function param(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}
