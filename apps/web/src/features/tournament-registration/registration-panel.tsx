import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
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
  type TournamentEntriesResult,
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
} from "./presentation";
import {
  approveTournamentEntry,
  declineTournamentEntry,
  registerForTournament,
  removeTournamentEntry,
  withdrawTournamentEntry,
} from "./tournament.functions";

type Run = (request: () => Promise<TournamentMutationResult>) => Promise<void>;

/**
 * Where an event with a tournament puts its RSVP buttons: register alone or
 * with a team, or see why registration is not open. The event summary card
 * around it states the format, count, and cost. Every control is a
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
  const approval = tournament.registration_mode === "approval";

  return (
    <section
      className="event-summary__action"
      aria-labelledby="event-registration-heading"
      id="registration"
    >
      <h2 id="event-registration-heading">
        {state === "registered"
          ? "You're in"
          : state === "requested"
            ? "Request sent"
            : approval
              ? "Request to join"
              : "Register"}
      </h2>
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
      ) : state === "requested" && entry ? (
        <>
          <p>
            {entry.team ? (
              <>
                Your request for{" "}
                <Link to="/teams/$slug" params={{ slug: entry.team.slug }}>
                  {entry.team.name}
                </Link>{" "}
                is waiting for the organizers.
              </>
            ) : (
              "Your request is waiting for the organizers."
            )}{" "}
            You hold no spot until they approve it.
          </p>
          {entry.can_manage && tournament.status === "registration_open" ? (
            <EntryButton
              action={withdrawTournamentEntry}
              entryID={entry.id}
              label="Cancel request"
              pending={mutation.pending}
              run={run}
              slug={event.slug}
            />
          ) : null}
        </>
      ) : state === "not-open" ? (
        <p className="rsvp-note">
          Registration is not open yet. Open it in the{" "}
          <Link to="/events/$slug/tournament" params={{ slug: event.slug }}>
            tournament settings
          </Link>{" "}
          when they are ready.
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
      ) : approval ? (
        <p className="form-help">
          The organizers approve each entry. Sending a request holds no spot
          until they do.
        </p>
      ) : null}
      {state !== "open" ? null : tournament.entry_type === "solo" ? (
        <SoloRegistration
          approval={approval}
          pending={mutation.pending}
          run={run}
          slug={event.slug}
        />
      ) : (
        <TeamRegistration
          approval={approval}
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
  approval,
  pending,
  run,
  slug,
}: {
  approval: boolean;
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
          {approval ? "Request to join" : "Register"}
        </Button>
      </div>
    </form>
  );
}

function TeamRegistration({
  approval,
  pending,
  run,
  slug,
  teams,
  tournament,
}: {
  approval: boolean;
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
              {approval
                ? `Request to join with ${team.name}`
                : `Register ${team.name}`}
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
  returnTo,
  run,
  slug,
  variant = "secondary",
}: {
  action: typeof withdrawTournamentEntry;
  entryID: string;
  label: string;
  pending: boolean;
  returnTo?: "entrants";
  run: Run;
  slug: string;
  variant?: "primary" | "secondary";
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
      {returnTo ? (
        <input name="return_to" type="hidden" value={returnTo} />
      ) : null}
      <Button disabled={pending} size="small" type="submit" variant={variant}>
        {label}
      </Button>
    </form>
  );
}

/**
 * The tournament's entrants in seed order. Signed-in viewers see every name;
 * signed-out viewers see team names and solo entrants by seed. The event's
 * Overview shows the first few and links to the Players or Teams tab, which
 * lists everyone; there organizers can remove an entry until the start.
 */
export function EntrantsCard({
  canRemove = false,
  entries,
  preview,
  slug,
  tournament,
}: {
  canRemove?: boolean;
  entries: TournamentEntriesResult;
  /** How many to show before the link to the full list, on Overview. */
  preview?: number;
  slug: string;
  tournament: TournamentDTO;
}) {
  const shown =
    entries.status === "ready" && preview !== undefined
      ? entries.items.slice(0, preview)
      : entries.status === "ready"
        ? entries.items
        : [];
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
            {shown.map((entry) => (
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
                    returnTo="entrants"
                    run={run}
                    slug={slug}
                  />
                ) : null}
              </li>
            ))}
          </ol>
        )}
        {preview !== undefined &&
        entries.status === "ready" &&
        entries.items.length > preview ? (
          <Link
            className="link with-arrow"
            params={{ slug }}
            to="/events/$slug/entrants"
          >
            {`See all ${tournament.entry_type === "team" ? "teams" : "players"}`}
            <ArrowRight aria-hidden="true" size={14} strokeWidth={2.25} />
          </Link>
        ) : null}
      </div>
    </Surface>
  );
}

/**
 * An approval tournament's pending requests, for its organizers: each with
 * Approve, Decline, and Remove (which blocks the requester) until the start.
 */
export function RequestsCard({
  canDecide,
  requests,
  slug,
}: {
  canDecide: boolean;
  requests: TournamentEntryDTO[];
  slug: string;
}) {
  const mutation = useEnhancedMutation(
    "We could not update that request. Please try again.",
  );
  const run: Run = (request) => mutation.execute(request);
  return (
    <Surface
      variant="card"
      aria-labelledby="event-requests-title"
      id="requests"
    >
      <h2 id="event-requests-title">{`Requests (${requests.length})`}</h2>
      <div className="detail-card-body">
        <FormErrorSummary
          fieldErrors={mutation.fieldErrors}
          message={mutation.message}
          summaryRef={mutation.errorSummaryRef}
        />
        {requests.length === 0 ? (
          <p>No requests are waiting.</p>
        ) : (
          <>
            <p className="form-help">
              Oldest first. Approving gives the entrant the next seed. A
              declined entrant can ask again; a removed one can't.
            </p>
            <ol className="tournament-entrants">
              {requests.map((request) => (
                <li key={request.id}>
                  <span>
                    {request.player ? (
                      <Link
                        to="/users/$id"
                        params={{ id: request.player.public_id }}
                      >
                        {request.player.name}
                      </Link>
                    ) : request.team ? (
                      <Link
                        to="/teams/$slug"
                        params={{ slug: request.team.slug }}
                      >
                        {request.team.name}
                      </Link>
                    ) : null}
                    {request.roster && request.roster.length > 0 ? (
                      <small>
                        {" · "}
                        {request.roster.map((player) => player.name).join(", ")}
                      </small>
                    ) : null}
                  </span>
                  {canDecide ? (
                    <span className="actions">
                      <EntryButton
                        action={approveTournamentEntry}
                        entryID={request.id}
                        label={`Approve ${entrantName(request)}`}
                        pending={mutation.pending}
                        run={run}
                        slug={slug}
                        variant="primary"
                      />
                      <EntryButton
                        action={declineTournamentEntry}
                        entryID={request.id}
                        label={`Decline ${entrantName(request)}`}
                        pending={mutation.pending}
                        run={run}
                        slug={slug}
                      />
                      <EntryButton
                        action={removeTournamentEntry}
                        entryID={request.id}
                        label={`Remove ${entrantName(request)}`}
                        pending={mutation.pending}
                        run={run}
                        slug={slug}
                      />
                    </span>
                  ) : null}
                </li>
              ))}
            </ol>
          </>
        )}
      </div>
    </Surface>
  );
}
