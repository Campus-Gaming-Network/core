import { useServerFn } from "@tanstack/react-start";
import type { FormEvent } from "react";
import {
  FormErrorSummary,
  useEnhancedMutation,
} from "../../components/enhanced-mutation";
import { GameSelect } from "../../components/game-select";
import { catalogGamesFromSummaries } from "../game-picker/game-select-helpers";
import { GameTile } from "../game-picker/game-tile";
import {
  maximumFavoriteGames,
  profileGameListLabels,
  profileGameLists,
  type ListedGameDTO,
  type ProfileGameList,
  type ProfileGamesPageResult,
} from "./contracts";
import {
  addProfileGames,
  moveProfileGame,
  removeProfileGame,
} from "./profile-games.functions";

/**
 * The profile settings section for the game lists: each list's games in
 * order, with Move up, Move down, and Remove, then a field that adds games
 * to it. Every control is its own native form, so it works without
 * JavaScript; with JavaScript the same server functions run in place.
 */
export function ProfileGamesEditor({
  page,
}: {
  page: Exclude<ProfileGamesPageResult, { status: "unauthenticated" }>;
}) {
  return (
    <section
      aria-labelledby="games-heading"
      className="profile-games profile-games--settings"
      id="games"
    >
      <h2 id="games-heading">Games</h2>
      <p className="form-help">
        Show other players what you play. Your lists appear on your public
        profile. A game is in one list at a time, so adding it to another list
        moves it.
      </p>
      {page.status === "ready" ? (
        profileGameLists.map((list) => (
          <GameListEditor
            catalog={page.catalog}
            games={page.lists[list]}
            key={list}
            list={list}
          />
        ))
      ) : (
        <p>Your game lists are unavailable right now. Try again later.</p>
      )}
    </section>
  );
}

function GameListEditor({
  catalog,
  games,
  list,
}: {
  catalog: ListedGameDTO[];
  games: ListedGameDTO[];
  list: ProfileGameList;
}) {
  const runAdd = useServerFn(addProfileGames);
  const runMove = useServerFn(moveProfileGame);
  const runRemove = useServerFn(removeProfileGame);
  const mutation = useEnhancedMutation(
    "We could not update your games. Please try again.",
  );
  const label = profileGameListLabels[list];
  const headingID = `games-${list}-heading`;
  const errorID = `games-${list}-error`;
  const full = list === "favorite" && games.length >= maximumFavoriteGames;
  const listedIDs = new Set(games.map((game) => game.id));
  const offered = catalog.filter((game) => !listedIDs.has(game.id));

  function submitWith(
    run: (form: FormData) => Promise<Awaited<ReturnType<typeof runAdd>>>,
  ) {
    return async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      await mutation.execute(() => run(form));
    };
  }

  return (
    <div aria-labelledby={headingID} className="profile-game-list" role="group">
      <h3 id={headingID}>
        {label}
        {list === "favorite" ? (
          <span className="profile-game-list__count">
            {" "}
            ({games.length} of {maximumFavoriteGames})
          </span>
        ) : null}
      </h3>
      <FormErrorSummary
        fieldErrors={mutation.fieldErrors}
        fieldIds={{ game_ids: errorID }}
        message={mutation.message}
        summaryRef={mutation.errorSummaryRef}
      />
      {games.length > 0 ? (
        <ol className="profile-game-list__games">
          {games.map((game, index) => (
            <li key={game.id}>
              <GameTile
                coverURL={catalogGamesFromSummaries([game])[0]?.coverURL}
              />
              <span className="profile-game-list__name">{game.name}</span>
              <span className="profile-game-list__actions">
                {index > 0 ? (
                  <form
                    action={moveProfileGame.url}
                    method="post"
                    onSubmit={submitWith((data) => runMove({ data }))}
                  >
                    <input name="game_id" type="hidden" value={game.id} />
                    <input name="position" type="hidden" value={index - 1} />
                    <button
                      className="button--secondary button--small"
                      disabled={mutation.pending}
                      type="submit"
                    >
                      Move up
                      <span className="visually-hidden"> {game.name}</span>
                    </button>
                  </form>
                ) : null}
                {index < games.length - 1 ? (
                  <form
                    action={moveProfileGame.url}
                    method="post"
                    onSubmit={submitWith((data) => runMove({ data }))}
                  >
                    <input name="game_id" type="hidden" value={game.id} />
                    <input name="position" type="hidden" value={index + 1} />
                    <button
                      className="button--secondary button--small"
                      disabled={mutation.pending}
                      type="submit"
                    >
                      Move down
                      <span className="visually-hidden"> {game.name}</span>
                    </button>
                  </form>
                ) : null}
                <form
                  action={removeProfileGame.url}
                  method="post"
                  onSubmit={submitWith((data) => runRemove({ data }))}
                >
                  <input name="game_id" type="hidden" value={game.id} />
                  <button
                    className="button--secondary button--small"
                    disabled={mutation.pending}
                    type="submit"
                  >
                    Remove<span className="visually-hidden"> {game.name}</span>
                  </button>
                </form>
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="profile-game-list__empty">No games yet.</p>
      )}
      {full ? (
        <p className="form-help">
          You have five favorites. Remove one to add another.
        </p>
      ) : (
        <form
          action={addProfileGames.url}
          className="form-stack profile-game-list__add"
          method="post"
          onSubmit={submitWith((data) => runAdd({ data }))}
        >
          <input name="list" type="hidden" value={list} />
          <GameSelect
            catalog={catalogGamesFromSummaries(offered)}
            errorId={errorID}
            errors={mutation.fieldErrors.game_ids}
            fallback={
              <label>
                Add a game to {label.toLowerCase()}
                <select name="game_ids" defaultValue="">
                  <option value="">Choose a game</option>
                  {offered.map((game) => (
                    <option key={game.id} value={game.id}>
                      {game.name}
                    </option>
                  ))}
                </select>
              </label>
            }
            label={`Add to ${label.toLowerCase()}`}
            otherGameErrorId={`games-${list}-other-error`}
            otherGameErrors={mutation.fieldErrors.other_game}
          />
          <div className="form-actions">
            <button disabled={mutation.pending} type="submit">
              {mutation.pending ? "Adding…" : `Add to ${label.toLowerCase()}`}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
