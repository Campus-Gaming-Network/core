import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import type { FormEvent, ReactNode } from "react";
import { ButtonLink } from "../../components/button-link";
import { Button } from "../../components/button";
import {
  FormErrorSummary,
  useEnhancedMutation,
} from "../../components/enhanced-mutation";
import { PageNoticeView } from "../../components/page-notice-view";
import { Surface } from "../../components/surface";
import type { EventDTO } from "../event-slice/contracts";
import {
  tournamentNotices,
  type RegistrationTeamDTO,
  type TournamentDTO,
  type TournamentEntryDTO,
  type TournamentListResult,
  type TournamentMutationResult,
  type TournamentNotice,
} from "./contracts";
import {
  entrantName,
  entrantsHeading,
  registrationClosesLabel,
  registrationState,
  tournamentSummary,
} from "./presentation";
import {
  registerForTournament,
  removeTournamentEntry,
  withdrawTournamentEntry,
} from "./tournament.functions";

type Run = (request: () => Promise<TournamentMutationResult>) => Promise<void>;

/**
 * Where an event with a tournament puts its RSVP buttons: register alone or
 * with a team, or see why registration is not open. Every control is a
 * native form, so it works without JavaScript. `children` (the Interested
 * button) stays for spectators.
 */
export function RegistrationPanel({
  authenticated,
  children,
  event,
  notice,
  renderedAt,
  teams,
  tournament,
}: {
  authenticated: boolean;
  children?: ReactNode;
  event: EventDTO;
  notice?: TournamentNotice;
  renderedAt: Date;
  teams?: TournamentListResult<RegistrationTeamDTO>;
  tournament: TournamentDTO;
}) {
  const mutation = useEnhancedMutation(
    "We could not update your registration. Please try again.",
  );
  const run: Run = (request) => mutation.execute(request);
  const state = registrationState(tournament, {
    authenticated,
    now: renderedAt,
    startsAt: event.starts_at,
  });
  const entry = tournament.viewer_entry;

  return (
    <section
      className="event-header__rsvp"
      aria-labelledby="event-registration-heading"
      id="registration"
    >
      <h2 id="event-registration-heading">
        {state === "registered" ? "You're in" : "Register"}
      </h2>
      <p className="rsvp-note">{tournamentSummary(tournament)}</p>
      <PageNoticeView notice={notice ? tournamentNotices[notice] : undefined} />
      <FormErrorSummary
        fieldErrors={mutation.fieldErrors}
        message={mutation.message}
        summaryRef={mutation.errorSummaryRef}
      />
      {state === "registered" && entry ? (
        <>
          <p>
            {entry.team ? (
              <>
                Registered with{" "}
                <Link to="/teams/$slug" params={{ slug: entry.team.slug }}>
                  {entry.team.name}
                </Link>
                .
              </>
            ) : (
              "You're registered."
            )}
          </p>
          {entry.can_manage && tournament.status === "registration_open" ? (
            <EntryButton
              action={withdrawTournamentEntry}
              entryID={entry.id}
              label={entry.team ? "Withdraw the team" : "Withdraw"}
              pending={mutation.pending}
              run={run}
              slug={event.slug}
            />
          ) : null}
        </>
      ) : state === "not-open" ? (
        <p className="rsvp-note">
          Registration is not open yet. Open it when the settings are ready.
        </p>
      ) : state === "closed" ? (
        <p className="rsvp-note">Registration is closed.</p>
      ) : state === "full" ? (
        <p className="rsvp-note">This tournament is full.</p>
      ) : state === "signed-out" ? (
        <ButtonLink
          variant="primary"
          to="/login"
          search={{ next: `/events/${event.slug}` }}
        >
          Log in to register
        </ButtonLink>
      ) : tournament.entry_type === "solo" ? (
        <SoloRegistration
          pending={mutation.pending}
          run={run}
          slug={event.slug}
        />
      ) : (
        <TeamRegistration
          pending={mutation.pending}
          run={run}
          slug={event.slug}
          teams={teams}
          tournament={tournament}
        />
      )}
      {children}
      {state === "open" || state === "signed-out" ? (
        <p className="rsvp-help">
          {registrationClosesLabel(tournament, {
            startsAt: event.starts_at,
            timeZone: event.timezone,
          })}
        </p>
      ) : null}
    </section>
  );
}

function SoloRegistration({
  pending,
  run,
  slug,
}: {
  pending: boolean;
  run: Run;
  slug: string;
}) {
  const runRegister = useServerFn(registerForTournament);
  async function submit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    const data = new FormData(formEvent.currentTarget);
    await run(() => runRegister({ data }));
  }
  return (
    <form
      action={registerForTournament.url}
      className="form-stack"
      method="post"
      onSubmit={submit}
    >
      <input name="slug" type="hidden" value={slug} />
      <p className="form-help">
        Your name appears in the player list and bracket for anyone signed in,
        even if you hide yourself from people lists.
      </p>
      <div className="form-actions">
        <Button disabled={pending} type="submit">
          Register
        </Button>
      </div>
    </form>
  );
}

function TeamRegistration({
  pending,
  run,
  slug,
  teams,
  tournament,
}: {
  pending: boolean;
  run: Run;
  slug: string;
  teams?: TournamentListResult<RegistrationTeamDTO>;
  tournament: TournamentDTO;
}) {
  const runRegister = useServerFn(registerForTournament);
  async function submit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    const data = new FormData(formEvent.currentTarget);
    await run(() => runRegister({ data }));
  }
  if (!teams || teams.status === "unavailable") {
    return (
      <p className="rsvp-note">
        Your teams could not be loaded. Try again in a moment.
      </p>
    );
  }
  const open = teams.items.filter((team) => !team.entered);
  if (open.length === 0) {
    return (
      <p className="rsvp-note">
        A team's owner or a captain registers it.{" "}
        <Link to="/teams/new">Create a team</Link> to enter.
      </p>
    );
  }
  const size = tournament.team_size ?? 0;
  const most = size + tournament.substitutes;
  return (
    <>
      {open.map((team) => (
        <form
          action={registerForTournament.url}
          className="form-stack"
          key={team.id}
          method="post"
          onSubmit={submit}
        >
          <input name="slug" type="hidden" value={slug} />
          <input name="team_slug" type="hidden" value={team.slug} />
          <fieldset>
            <legend>{`Register ${team.name}`}</legend>
            <p className="form-help">
              {size === most
                ? `Pick ${size} players.`
                : `Pick ${size} to ${most} players.`}
            </p>
            <div className="team-option-list">
              {team.members.map((member) => (
                <label className="checkbox-field" key={member.public_id}>
                  <input
                    name="roster"
                    type="checkbox"
                    value={member.public_id}
                  />
                  {member.name}
                </label>
              ))}
            </div>
          </fieldset>
          <p className="form-help">
            Your team and its roster appear in the team list and bracket for
            anyone signed in.
          </p>
          <div className="form-actions">
            <Button disabled={pending} type="submit">
              {`Register ${team.name}`}
            </Button>
          </div>
        </form>
      ))}
    </>
  );
}

function EntryButton({
  action,
  entryID,
  label,
  pending,
  run,
  slug,
}: {
  action: typeof withdrawTournamentEntry;
  entryID: string;
  label: string;
  pending: boolean;
  run: Run;
  slug: string;
}) {
  const runAction = useServerFn(action);
  async function submit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    const data = new FormData(formEvent.currentTarget);
    await run(() => runAction({ data }));
  }
  return (
    <form action={action.url} method="post" onSubmit={submit}>
      <input name="slug" type="hidden" value={slug} />
      <input name="entry_id" type="hidden" value={entryID} />
      <Button disabled={pending} size="small" type="submit" variant="secondary">
        {label}
      </Button>
    </form>
  );
}

/**
 * The tournament's entrants in seed order. Signed-in viewers see every name;
 * signed-out viewers see team names and solo entrants by seed. Organizers can
 * remove an entry until the tournament starts.
 */
export function EntrantsCard({
  canRemove,
  entries,
  slug,
  tournament,
}: {
  canRemove: boolean;
  entries: TournamentListResult<TournamentEntryDTO>;
  slug: string;
  tournament: TournamentDTO;
}) {
  const mutation = useEnhancedMutation(
    "We could not remove that entry. Please try again.",
  );
  const run: Run = (request) => mutation.execute(request);
  return (
    <Surface variant="card" aria-labelledby="event-entrants-title">
      <h2 id="event-entrants-title">{entrantsHeading(tournament)}</h2>
      <div className="detail-card-body">
        <FormErrorSummary
          fieldErrors={mutation.fieldErrors}
          message={mutation.message}
          summaryRef={mutation.errorSummaryRef}
        />
        {entries.status === "unavailable" ? (
          <p>The entrant list could not be loaded. Try again in a moment.</p>
        ) : entries.items.length === 0 ? (
          <p>No one has registered yet.</p>
        ) : (
          <ol className="tournament-entrants">
            {entries.items.map((entry) => (
              <li key={entry.id}>
                <span>
                  {entry.player ? (
                    <Link
                      to="/users/$id"
                      params={{ id: entry.player.public_id }}
                    >
                      {entry.player.name}
                    </Link>
                  ) : entry.team ? (
                    <Link to="/teams/$slug" params={{ slug: entry.team.slug }}>
                      {entry.team.name}
                    </Link>
                  ) : (
                    entrantName(entry)
                  )}
                  {entry.roster && entry.roster.length > 0 ? (
                    <small>
                      {" · "}
                      {entry.roster.map((player) => player.name).join(", ")}
                    </small>
                  ) : null}
                </span>
                {canRemove ? (
                  <EntryButton
                    action={removeTournamentEntry}
                    entryID={entry.id}
                    label={`Remove ${entrantName(entry)}`}
                    pending={mutation.pending}
                    run={run}
                    slug={slug}
                  />
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </div>
    </Surface>
  );
}
