import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import type { CSSProperties, FormEvent } from "react";
import { Button } from "../../components/button";
import {
  FormErrorSummary,
  useEnhancedMutation,
} from "../../components/enhanced-mutation";
import { FormField } from "../../components/form-field";
import { Surface } from "../../components/surface";
import { TabLink, Tabs } from "../../components/tabs";
import type { TournamentDTO } from "../tournament-registration/contracts";
import { generateBracket, recordMatchResult } from "./bracket.functions";
import {
  maximumMatchScore,
  type MatchEntrantDTO,
  type TournamentMatchDTO,
} from "./contracts";
import {
  bracketRounds,
  entrantName,
  matchSummary,
  tournamentSections,
  type TournamentSection,
} from "./presentation";

const sectionPaths = {
  overview: "/events/$slug",
  entrants: "/events/$slug/entrants",
  bracket: "/events/$slug/bracket",
  rules: "/events/$slug/rules",
  prizes: "/events/$slug/prizes",
} as const satisfies Record<TournamentSection, string>;

/**
 * A tournament event's section tabs. Each is a plain link, so they work
 * without JavaScript, and a tab shows only when its section has content.
 */
export function TournamentTabs({
  current,
  hasBracket,
  slug,
  tournament,
}: {
  current: TournamentSection;
  hasBracket: boolean;
  slug: string;
  tournament: TournamentDTO;
}) {
  return (
    <Tabs label="Tournament sections">
      {tournamentSections(tournament, hasBracket).map(({ section, label }) => (
        <TabLink
          current={section === current}
          key={section}
          params={{ slug }}
          to={sectionPaths[section]}
        >
          {label}
        </TabLink>
      ))}
    </Tabs>
  );
}

/**
 * The bracket: rounds left to right on a wide screen, each match centred
 * between the two that feed it, and the same rounds stacked as lists on a
 * phone. Every match is a link to its page, named with its entrants, scores,
 * and outcome. "Jump to round" links scroll a wide bracket to a round.
 */
export function BracketView({
  matches,
  slug,
}: {
  matches: TournamentMatchDTO[];
  slug: string;
}) {
  const rounds = bracketRounds(matches);
  const firstRoundRows = 2 ** Math.max(0, rounds.length - 1);
  return (
    <div className="bracket">
      {rounds.length > 2 ? (
        <nav aria-label="Jump to round" className="bracket__jump">
          {rounds.map((round) => (
            <a href={`#round-${round.round}`} key={round.round}>
              {round.name}
            </a>
          ))}
        </nav>
      ) : null}
      <div className="bracket__scroller">
        <ol
          className="bracket__rounds"
          style={{ "--bracket-rows": firstRoundRows } as CSSProperties}
        >
          {rounds.map((round) => (
            <li
              aria-labelledby={`round-${round.round}-title`}
              className="bracket__round"
              id={`round-${round.round}`}
              key={round.round}
            >
              <h2 id={`round-${round.round}-title`}>{round.name}</h2>
              <ol className="bracket__matches">
                {round.items.map((item) => (
                  <li
                    className={[
                      "bracket__item",
                      round.round === rounds.length
                        ? "bracket__item--final"
                        : // Odd positions join downward to their pair.
                          ((item.row - 1) / item.span) % 2 === 0
                          ? "bracket__item--top"
                          : "bracket__item--bottom",
                    ].join(" ")}
                    key={
                      item.kind === "bye" ? `bye-${item.row}` : item.match.id
                    }
                    style={
                      {
                        gridRow: `${item.row} / span ${item.span}`,
                        "--bracket-span": item.span,
                      } as CSSProperties
                    }
                  >
                    {item.kind === "bye" ? (
                      <p className="bracket-bye">
                        <span>{entrantName(item.bye.entrant)}</span>
                        <small>{`Seed ${item.bye.entrant.seed} · bye`}</small>
                      </p>
                    ) : (
                      <MatchCard
                        match={item.match}
                        rounds={rounds.length}
                        slug={slug}
                      />
                    )}
                  </li>
                ))}
              </ol>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function MatchCard({
  match,
  rounds,
  slug,
}: {
  match: TournamentMatchDTO;
  rounds: number;
  slug: string;
}) {
  return (
    <Link
      aria-label={matchSummary(match, rounds)}
      className="bracket-match"
      data-status={match.status}
      params={{ slug, matchId: match.id }}
      to="/events/$slug/matches/$matchId"
    >
      {match.entrants.map((entrant, slot) => (
        <span
          className={
            entrant && entrant.entry_id === match.winner_entry_id
              ? "bracket-match__side bracket-match__side--winner"
              : "bracket-match__side"
          }
          // Each slot is fixed, so its index is a stable key.
          // oxlint-disable-next-line react/no-array-index-key
          key={slot}
        >
          <span className="bracket-match__seed">{entrant?.seed ?? ""}</span>
          <span className="bracket-match__name">
            {entrant ? entrantName(entrant) : "To be decided"}
          </span>
          <span className="bracket-match__score">
            {match.scores
              ? match.scores[slot]
              : match.walkover && entrant?.entry_id === match.winner_entry_id
                ? "W/O"
                : ""}
          </span>
        </span>
      ))}
    </Link>
  );
}

/**
 * An organizer's forms for a match whose entrants are both decided: the
 * winner and both scores, or a walkover for a no-show. Sending a result for
 * a match that has one corrects it.
 */
export function ResultForms({
  entrants,
  match,
  slug,
}: {
  /** Both sides, decided. */
  entrants: [MatchEntrantDTO, MatchEntrantDTO];
  match: TournamentMatchDTO;
  slug: string;
}) {
  const mutation = useEnhancedMutation(
    "We could not save the result. Please try again.",
  );
  const record = useServerFn(recordMatchResult);
  async function submit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    const data = new FormData(formEvent.currentTarget);
    await mutation.execute(() => record({ data }));
  }
  const corrected = Boolean(match.winner_entry_id);
  const winnerChoices = (name: string) =>
    entrants.map((entrant) => (
      <label className="choice-card" key={entrant.entry_id}>
        <input
          defaultChecked={entrant.entry_id === match.winner_entry_id}
          name={name}
          required
          type="radio"
          value={entrant.entry_id}
        />
        <span className="choice-card-title">{entrantName(entrant)}</span>
        <span className="choice-card-hint">{`Seed ${entrant.seed}`}</span>
      </label>
    ));
  return (
    <Surface variant="panel" aria-labelledby="match-result-heading">
      <h2 id="match-result-heading">
        {corrected ? "Correct the result" : "Enter the result"}
      </h2>
      <p className="form-help">
        {corrected
          ? "The result can change until the winner's next match has a result. A new winner takes the old one's place in that match."
          : "The winner moves on to their next match as soon as you save. The final's result completes the tournament."}
      </p>
      <FormErrorSummary
        fieldErrors={mutation.fieldErrors}
        message={mutation.message}
        summaryRef={mutation.errorSummaryRef}
      />
      <form
        action={recordMatchResult.url}
        className="match-result-form"
        method="post"
        onSubmit={submit}
      >
        <input name="slug" type="hidden" value={slug} />
        <input name="match_id" type="hidden" value={match.id} />
        <input name="walkover" type="hidden" value="false" />
        <fieldset className="choice-group">
          <legend>Winner</legend>
          <div className="choice-cards">{winnerChoices("winner_entry_id")}</div>
        </fieldset>
        <div className="match-result-form__scores">
          {entrants.map((entrant, slot) => (
            <FormField
              errorId={`match-score-${slot + 1}-error`}
              key={entrant.entry_id}
              label={`${entrantName(entrant)}'s score`}
            >
              <input
                defaultValue={match.scores?.[slot]?.toString() ?? ""}
                inputMode="numeric"
                max={maximumMatchScore}
                min={0}
                name={`score${slot + 1}`}
                required
                step={1}
                type="number"
              />
            </FormField>
          ))}
        </div>
        <Button disabled={mutation.pending} type="submit" variant="primary">
          {corrected ? "Save correction" : "Save result"}
        </Button>
      </form>
      <form
        action={recordMatchResult.url}
        className="match-result-form"
        method="post"
        onSubmit={submit}
      >
        <input name="slug" type="hidden" value={slug} />
        <input name="match_id" type="hidden" value={match.id} />
        <input name="walkover" type="hidden" value="true" />
        <fieldset className="choice-group">
          <legend>Walkover: who advances?</legend>
          <p className="form-help">
            For a no-show. The other side advances without a score.
          </p>
          <div className="choice-cards">{winnerChoices("winner_entry_id")}</div>
        </fieldset>
        <Button disabled={mutation.pending} type="submit" variant="secondary">
          Record walkover
        </Button>
      </form>
    </Surface>
  );
}

/**
 * Generates the bracket from the registered entries in seed order, or
 * builds it again until a match has a result.
 */
export function GenerateBracketForm({ slug }: { slug: string }) {
  const mutation = useEnhancedMutation(
    "We could not generate the bracket. Please try again.",
  );
  const generate = useServerFn(generateBracket);
  async function submit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    const data = new FormData(formEvent.currentTarget);
    await mutation.execute(() => generate({ data }));
  }
  return (
    <Surface variant="panel" aria-labelledby="generate-bracket-heading">
      <h2 id="generate-bracket-heading">Bracket</h2>
      <p className="form-help">
        Builds a single-elimination bracket from the entrants in seed order,
        with byes for the top seeds. You can build it again until a match has a
        result; that replaces the current bracket.
      </p>
      <FormErrorSummary
        fieldErrors={mutation.fieldErrors}
        message={mutation.message}
        summaryRef={mutation.errorSummaryRef}
      />
      <form action={generateBracket.url} method="post" onSubmit={submit}>
        <input name="slug" type="hidden" value={slug} />
        <div className="actions">
          <Button disabled={mutation.pending} type="submit" variant="primary">
            Generate bracket
          </Button>
          <Link className="link" params={{ slug }} to="/events/$slug/bracket">
            See the bracket
          </Link>
        </div>
      </form>
    </Surface>
  );
}
