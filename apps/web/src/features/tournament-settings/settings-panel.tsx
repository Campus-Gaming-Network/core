import { Link, useHydrated } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState, type FormEvent } from "react";
import { Button } from "../../components/button";
import { ButtonLink } from "../../components/button-link";
import { ConfirmDialog } from "../../components/confirm-dialog";
import {
  FormErrorSummary,
  useEnhancedMutation,
} from "../../components/enhanced-mutation";
import { FormField, RequiredFieldsNote } from "../../components/form-field";
import { FormSection } from "../../components/form-section";
import { Surface } from "../../components/surface";
import type { EventDTO } from "../event-slice/contracts";
import { instantToLocalDateTime } from "../event-slice/event-time";
import type {
  TournamentDTO,
  TournamentEntryDTO,
  TournamentMutationResult,
} from "../tournament-registration/contracts";
import {
  entrantName,
  tournamentSummary,
} from "../tournament-registration/presentation";
import {
  deleteTournamentSettings,
  saveTournamentSettings,
  setTournamentSeeds,
  setTournamentStatus,
} from "./settings.functions";
import { statusActions, tournamentStatusLabels } from "./presentation";

type Run = (request: () => Promise<TournamentMutationResult>) => Promise<void>;

/**
 * The tournament's status and the moves an organizer can make from it. Each
 * move is a native form; cancelling asks first once the page is interactive.
 */
export function StatusPanel({
  event,
  tournament,
}: {
  event: EventDTO;
  tournament: TournamentDTO;
}) {
  const mutation = useEnhancedMutation(
    "We could not update the tournament. Please try again.",
  );
  const run: Run = (request) => mutation.execute(request);
  const actions = statusActions(tournament, {
    ended: event.lifecycle === "ended",
  });
  return (
    <Surface variant="panel" aria-labelledby="tournament-status-heading">
      <h2 id="tournament-status-heading">
        {`Status: ${tournamentStatusLabels[tournament.status]}`}
      </h2>
      <p className="form-help">{tournamentSummary(tournament)}</p>
      <FormErrorSummary
        fieldErrors={mutation.fieldErrors}
        message={mutation.message}
        summaryRef={mutation.errorSummaryRef}
      />
      {actions.length === 0 ? (
        <p className="form-help">
          {tournament.status === "completed" ||
          tournament.status === "cancelled"
            ? "This tournament can no longer change."
            : "The event has ended. Start the tournament before it ends to complete it here."}
        </p>
      ) : (
        <div className="actions">
          {actions.map((action) =>
            action.kind === "delete" ? (
              <ActionForm
                action={deleteTournamentSettings}
                key="delete"
                label="Delete settings"
                pending={mutation.pending}
                run={run}
                slug={event.slug}
                variant="secondary"
              />
            ) : (
              <ActionForm
                action={setTournamentStatus}
                confirm={
                  action.status === "cancelled"
                    ? {
                        heading: "Cancel this tournament?",
                        body: "Registration closes and the tournament can't be restarted. The event itself stays on.",
                        label: "Yes, cancel tournament",
                      }
                    : undefined
                }
                key={action.status}
                label={action.label}
                pending={mutation.pending}
                run={run}
                slug={event.slug}
                status={action.status}
                variant={
                  action.status === "cancelled"
                    ? "destructive"
                    : action.primary
                      ? "primary"
                      : "secondary"
                }
              />
            ),
          )}
        </div>
      )}
      {tournament.status === "registration_open" &&
      event.lifecycle !== "ended" ? (
        <p className="form-help">
          {tournament.entry_count < 2
            ? "Starting needs at least two entrants. "
            : ""}
          {tournament.entry_count + (tournament.request_count ?? 0) > 0
            ? "Someone has registered or asked to, so it can't go back to draft."
            : ""}
        </p>
      ) : null}
      {tournament.request_count ? (
        <p className="form-help">
          {`${tournament.request_count === 1 ? "1 request is" : `${tournament.request_count} requests are`} waiting. `}
          <Link
            hash="requests"
            params={{ slug: event.slug }}
            to="/events/$slug"
          >
            Approve or decline them on the event page
          </Link>
          . Starting the tournament declines any still waiting.
        </p>
      ) : null}
    </Surface>
  );
}

function ActionForm({
  action,
  confirm,
  label,
  pending,
  run,
  slug,
  status,
  variant,
}: {
  action: typeof setTournamentStatus | typeof deleteTournamentSettings;
  confirm?: { heading: string; body: string; label: string };
  label: string;
  pending: boolean;
  run: Run;
  slug: string;
  status?: string;
  variant: "primary" | "secondary" | "destructive";
}) {
  const runAction = useServerFn(action);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [confirming, setConfirming] = useState(false);
  async function submit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    if (confirm && !confirming) {
      setConfirming(true);
      return;
    }
    const data = new FormData(formEvent.currentTarget);
    await run(() => runAction({ data }));
    setConfirming(false);
  }
  return (
    <form action={action.url} method="post" onSubmit={submit}>
      <input name="slug" type="hidden" value={slug} />
      {status ? <input name="status" type="hidden" value={status} /> : null}
      <Button
        disabled={pending}
        ref={triggerRef}
        type="submit"
        variant={variant}
      >
        {label}
      </Button>
      {confirm ? (
        <ConfirmDialog
          cancelLabel="Keep tournament"
          confirmLabel={confirm.label}
          heading={confirm.heading}
          onClose={() => setConfirming(false)}
          open={confirming}
          pending={pending}
          returnFocusRef={triggerRef}
        >
          <p>{confirm.body}</p>
        </ConfirmDialog>
      ) : null}
    </form>
  );
}

/**
 * The settings form. It creates the settings on an event without them and
 * replaces them otherwise. Once anyone has registered, the entry type and
 * team size are fixed, so they are shown as text and sent unchanged.
 */
export function SettingsForm({
  event,
  tournament,
}: {
  event: EventDTO;
  tournament?: TournamentDTO;
}) {
  const hydrated = useHydrated();
  const runSave = useServerFn(saveTournamentSettings);
  const mutation = useEnhancedMutation(
    "We could not save the tournament settings. Please try again.",
  );
  const [entryType, setEntryType] = useState(tournament?.entry_type ?? "solo");
  const fixed =
    (tournament?.entry_count ?? 0) + (tournament?.request_count ?? 0) > 0;
  const gameID = tournament?.game.id ?? event.games[0]?.id ?? "";
  const startsAtLocal = instantToLocalDateTime(event.starts_at, event.timezone);

  async function submit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    const data = new FormData(formEvent.currentTarget);
    await mutation.execute(() => runSave({ data }));
  }

  return (
    <form
      action={saveTournamentSettings.url}
      className="form-stack sectioned-form"
      method="post"
      onSubmit={submit}
    >
      <input name="slug" type="hidden" value={event.slug} />
      <input name="timezone" type="hidden" value={event.timezone} />
      <FormErrorSummary
        fieldErrors={mutation.fieldErrors}
        message={mutation.message}
        summaryRef={mutation.errorSummaryRef}
      />
      <RequiredFieldsNote />

      <FormSection
        title="Game and entry"
        description="What is played, and whether players enter alone or as teams."
      >
        <FormField errorId="tournament-game-error" label="Game">
          <select defaultValue={gameID} name="game_id" required>
            {event.games.map((game) => (
              <option key={game.id} value={game.id}>
                {game.name}
              </option>
            ))}
          </select>
        </FormField>
        <p className="form-help">
          One of the event's games. Add a game to the event to choose it here.
        </p>
        {fixed && tournament ? (
          <>
            <input
              name="entry_type"
              type="hidden"
              value={tournament.entry_type}
            />
            {tournament.team_size ? (
              <input
                name="team_size"
                type="hidden"
                value={tournament.team_size.toString()}
              />
            ) : null}
            <p className="form-help">
              {tournament.entry_type === "solo"
                ? "Solo entry"
                : `Teams of ${tournament.team_size ?? 0}`}
              . Someone has registered or asked to, so the entry type and team
              size are fixed.
            </p>
          </>
        ) : (
          <fieldset className="choice-group">
            <legend>Entry</legend>
            <div className="choice-cards">
              {(
                [
                  ["solo", "Solo", "Each player registers themselves"],
                  ["team", "Teams", "A team's owner or a captain registers it"],
                ] as const
              ).map(([value, label, hint]) => (
                <label className="choice-card" key={value}>
                  <input
                    defaultChecked={entryType === value}
                    name="entry_type"
                    onChange={(change) =>
                      setEntryType(change.currentTarget.value as typeof value)
                    }
                    required
                    type="radio"
                    value={value}
                  />
                  <span className="choice-card-title">{label}</span>
                  <span className="choice-card-hint">{hint}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}
        {/* Hidden only once the page is interactive, so a native submission
            still carries the values; a solo tournament ignores them. */}
        <div hidden={hydrated && entryType !== "team"}>
          {fixed ? null : (
            <FormField
              errorId="tournament-team-size-error"
              label="Team size (team entry only)"
              optional
            >
              <input
                defaultValue={tournament?.team_size?.toString() ?? "5"}
                inputMode="numeric"
                max={20}
                min={2}
                name="team_size"
                type="number"
              />
            </FormField>
          )}
          <FormField
            errorId="tournament-substitutes-error"
            label="Substitutes (team entry only)"
            optional
          >
            <input
              defaultValue={tournament?.substitutes.toString() ?? "0"}
              inputMode="numeric"
              max={20}
              min={0}
              name="substitutes"
              type="number"
            />
          </FormField>
          <p className="form-help">
            Players a team fields, 2 to 20, and extra roster places, up to the
            team size.
          </p>
        </div>
      </FormSection>

      <FormSection
        title="Registration"
        description="Who gets in, how many can enter, and when registration closes."
      >
        <fieldset className="choice-group">
          <legend>Who gets in</legend>
          <div className="choice-cards">
            {(
              [
                ["open", "Open", "Anyone signed in registers"],
                [
                  "approval",
                  "Organizer approval",
                  "Players request to join, and you approve each one",
                ],
              ] as const
            ).map(([value, label, hint]) => (
              <label className="choice-card" key={value}>
                <input
                  defaultChecked={
                    (tournament?.registration_mode ?? "open") === value
                  }
                  name="registration_mode"
                  required
                  type="radio"
                  value={value}
                />
                <span className="choice-card-title">{label}</span>
                <span className="choice-card-hint">{hint}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <p className="form-help">
          Use approval for a paid, invite-only, or vetted bracket. A request
          holds no spot until you approve it on the event page. If the event is
          paid, players see its payment note and link when they sign up.
        </p>
        <FormField
          errorId="tournament-cap-error"
          label="Entrant cap (leave blank for no limit)"
          optional
        >
          <input
            defaultValue={tournament?.entrant_cap?.toString() ?? ""}
            inputMode="numeric"
            max={512}
            min={2}
            name="entrant_cap"
            type="number"
          />
        </FormField>
        <p className="form-help">
          Counts entries, so teams in a team tournament. There is no waitlist.
        </p>
        <FormField
          errorId="tournament-closes-error"
          label="Registration closes"
          optional
        >
          <input
            defaultValue={
              tournament?.registration_closes_at
                ? instantToLocalDateTime(
                    tournament.registration_closes_at,
                    event.timezone,
                  )
                : ""
            }
            max={startsAtLocal}
            name="registration_closes_at"
            type="datetime-local"
          />
        </FormField>
        <p className="form-help">
          In the event's time zone. Leave it blank to close registration when
          the event starts.
        </p>
        <p className="form-help">Format: single elimination.</p>
      </FormSection>

      <FormSection
        title="Bracket"
        description="Running the bracket on start.gg, Challonge, Battlefy, or another site? Link it here."
      >
        <FormField
          errorId="tournament-bracket-error"
          label="Bracket link"
          optional
        >
          <input
            defaultValue={tournament?.bracket_url ?? ""}
            maxLength={500}
            name="bracket_url"
            placeholder="https://"
            type="url"
          />
        </FormField>
        <p className="form-help">
          The event page shows it as a link to an outside site. Leave it blank
          to remove it. With an outside bracket, mark the tournament complete
          here when it ends.
        </p>
      </FormSection>

      <FormSection
        title="Rules and prizes"
        description="Shown on the event page. Plain text."
      >
        <FormField
          characterCount
          errorId="tournament-rules-error"
          label="Rules"
          optional
        >
          <textarea
            defaultValue={tournament?.rules ?? ""}
            maxLength={10000}
            name="rules"
            rows={6}
          />
        </FormField>
        <FormField
          characterCount
          errorId="tournament-prizes-error"
          label="Prizes"
          optional
        >
          <textarea
            defaultValue={tournament?.prizes ?? ""}
            maxLength={2000}
            name="prizes"
            rows={3}
          />
        </FormField>
      </FormSection>

      <div className="form-actions">
        <ButtonLink
          params={{ slug: event.slug }}
          to="/events/$slug"
          variant="secondary"
        >
          Back to event
        </ButtonLink>
        <button disabled={mutation.pending} type="submit">
          {mutation.pending
            ? "Saving…"
            : tournament
              ? "Save settings"
              : "Create tournament"}
        </button>
      </div>
    </form>
  );
}

export function SeedsPanel({
  entries,
  locked,
  slug,
}: {
  entries: TournamentEntryDTO[];
  locked: boolean;
  slug: string;
}) {
  const mutation = useEnhancedMutation(
    "We could not save the seeds. Please try again.",
  );
  const save = useServerFn(setTournamentSeeds);
  async function submit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    const data = new FormData(formEvent.currentTarget);
    await mutation.execute(() => save({ data }));
  }
  return (
    <Surface
      variant="panel"
      aria-labelledby="tournament-seeds-heading"
      id="seeds"
    >
      <h2 id="tournament-seeds-heading">Seeds</h2>
      {entries.length === 0 ? (
        <p className="form-help">No one has registered yet.</p>
      ) : locked ? (
        <>
          <p className="form-help">
            A match has a result, so the seeds are fixed.
          </p>
          <ol className="tournament-entrants">
            {entries.map((entry) => (
              <li key={entry.id}>{entrantName(entry)}</li>
            ))}
          </ol>
        </>
      ) : (
        <>
          <p className="form-help">
            Seed 1 is the strongest. The bracket puts the top seeds furthest
            apart and gives them any byes. A bracket generated before you change
            the seeds keeps its order until you generate it again.
          </p>
          <FormErrorSummary
            fieldErrors={mutation.fieldErrors}
            message={mutation.message}
            summaryRef={mutation.errorSummaryRef}
          />
          <form
            action={setTournamentSeeds.url}
            className="seeds-form"
            method="post"
            onSubmit={submit}
          >
            <input name="slug" type="hidden" value={slug} />
            <ol className="seeds-form__list">
              {entries.map((entry, index) => (
                <li key={entry.id}>
                  <input name="entry_id" type="hidden" value={entry.id} />
                  <label>
                    <span>{entrantName(entry)}</span>
                    <input
                      defaultValue={(entry.seed ?? index + 1).toString()}
                      inputMode="numeric"
                      max={entries.length}
                      min={1}
                      name="seed"
                      required
                      step={1}
                      type="number"
                    />
                  </label>
                </li>
              ))}
            </ol>
            <Button disabled={mutation.pending} type="submit" variant="primary">
              Save seeds
            </Button>
          </form>
        </>
      )}
    </Surface>
  );
}
