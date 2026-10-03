import type { ReactNode } from "react";
import { ButtonLink } from "../../components/button-link";
import { Callout } from "../../components/callout";
import { Person } from "../../components/person";
import { ListUnavailable } from "../../components/route-boundaries";
import type { PeopleListResult, PersonDTO } from "./contracts";
import { personDetail } from "./presentation";

/** Everyone on a page of a list, each name linked to their public profile. */
export function PersonList({ people }: { people: PersonDTO[] }) {
  return (
    <ul className="people-list">
      {people.map((person) => (
        <li key={person.id}>
          <Person
            detail={personDetail(person)}
            id={person.id}
            linked
            name={person.name}
          />
        </li>
      ))}
    </ul>
  );
}

/**
 * What a visitor sees where signed-in viewers see a list. `next` is the page
 * to come back to after logging in.
 */
export function PeopleSignedOut({
  message,
  next,
}: {
  message: string;
  next: string;
}) {
  return (
    <Callout
      action={
        <ButtonLink variant="secondary" to="/login" search={{ next }}>
          Log in
        </ButtonLink>
      }
      icon="lock"
    >
      {message}
    </Callout>
  );
}

/**
 * The first people of a list, on the page of the event, school, or team they
 * belong to. A list that cannot be read is a quiet line, never a broken page.
 */
export function PeoplePreview({
  empty,
  result,
}: {
  empty: string;
  result: PeopleListResult;
}) {
  if (result.status !== "found") {
    return <p className="people-note">This list is unavailable right now.</p>;
  }
  if (result.list.people.length === 0) {
    return <p className="people-note">{empty}</p>;
  }
  return <PersonList people={result.list.people} />;
}

/**
 * A full page of a list: its people, or why there are none. The loader has
 * already sent visitors to log in and missing lists to a 404, so what reaches
 * here is a list, an empty list, or an outage.
 */
export function PeopleResults({
  emptyHeading,
  emptyMessage,
  result,
  unavailableHeading,
}: {
  emptyHeading: string;
  emptyMessage: string;
  result: PeopleListResult;
  unavailableHeading: string;
}) {
  if (result.status !== "found") {
    return <ListUnavailable heading={unavailableHeading} />;
  }
  if (result.list.people.length === 0) {
    return (
      <section className="empty-state">
        <h2>{emptyHeading}</h2>
        <p>{emptyMessage}</p>
      </section>
    );
  }
  return <PersonList people={result.list.people} />;
}

/** Previous and Next links, each present only when there is a page that way. */
export function PeoplePagination({
  label,
  next,
  previous,
}: {
  label: string;
  next?: ReactNode;
  previous?: ReactNode;
}) {
  if (!previous && !next) return null;

  return (
    <nav className="pagination people-pagination" aria-label={label}>
      {previous ?? <span />}
      <span />
      {next ?? <span />}
    </nav>
  );
}
