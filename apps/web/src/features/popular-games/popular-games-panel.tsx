import { Link } from "@tanstack/react-router";
import { catalogGamesFromSummaries } from "../game-picker/game-select-helpers";
import { GameTile } from "../game-picker/game-tile";
import type { PopularGamesResult } from "./contracts";
import { Surface } from "../../components/surface";

/**
 * A panel of the games most listed by upcoming public events, each linking
 * to the events list filtered by that game, and by the school when one is
 * given. With no games to show, or none readable, it renders nothing.
 */
export function PopularGamesPanel({
  heading,
  result,
  school,
}: {
  heading: string;
  result: PopularGamesResult;
  school?: string;
}) {
  if (result.status !== "ready" || result.games.length === 0) return null;
  const covers = catalogGamesFromSummaries(result.games);
  return (
    <Surface
      aria-labelledby="popular-games-heading"
      variant="panel"
      className="popular-games"
    >
      <h2 id="popular-games-heading">{heading}</h2>
      <ol className="popular-games__list">
        {result.games.map((game, index) => (
          <li key={game.id}>
            <Link
              className="popular-games__game"
              to="/events"
              search={{ game: game.slug, ...(school ? { school } : {}) }}
            >
              <GameTile coverURL={covers[index]?.coverURL} />
              <span className="popular-games__copy">
                <strong>{game.name}</strong>
                <small>
                  {game.upcoming_events} upcoming{" "}
                  {game.upcoming_events === 1 ? "event" : "events"}
                </small>
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </Surface>
  );
}
