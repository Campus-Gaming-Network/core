import { Link } from "@tanstack/react-router";
import { catalogGamesFromSummaries } from "../game-picker/game-select-helpers";
import { GameTile } from "../game-picker/game-tile";
import {
  profileGameListLabels,
  profileGameLists,
  type ProfileGameListsDTO,
} from "./contracts";

/** The public profile's Games panel: each list that has games, in order. */
export function ProfileGameLists({
  lists,
  self,
}: {
  lists?: ProfileGameListsDTO;
  self: boolean;
}) {
  const shown = profileGameLists.filter((list) => lists?.[list].length);

  return (
    <section aria-labelledby="profile-games" className="panel">
      <div className="panel__header">
        <h2 id="profile-games">Games</h2>
      </div>
      {lists && shown.length > 0 ? (
        <div className="panel__body profile-games">
          {shown.map((list) => (
            <div className="profile-game-list" key={list}>
              <h3>{profileGameListLabels[list]}</h3>
              <ol className="profile-game-list__games">
                {catalogGamesFromSummaries(lists[list]).map((game) => (
                  <li key={game.id}>
                    <GameTile coverURL={game.coverURL} />
                    <span className="profile-game-list__name">{game.name}</span>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      ) : (
        <p className="panel__body muted">
          {self ? (
            <>
              You have not listed any games.{" "}
              <Link hash="games" to="/settings/profile">
                Add games
              </Link>
            </>
          ) : (
            "No games listed yet."
          )}
        </p>
      )}
    </section>
  );
}
