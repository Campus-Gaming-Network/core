import { useEffect, useId, useState, useSyncExternalStore } from "react";
import {
  gameSearchResponseSchema,
  type GameSearchMatch,
} from "../features/game-picker/contracts";

const searchDelayMilliseconds = 250;

// Server rendering and hydration see `false`, so the markup matches.
const subscribeToNothing = () => () => {};

function matchTitle(match: GameSearchMatch): string {
  return match.release_year
    ? `${match.name} (${match.release_year})`
    : match.name;
}

/**
 * Lets a form name games its list does not offer. With JavaScript it searches
 * IGDB through this site and submits the chosen games in hidden fields. The
 * typed-name field works without JavaScript and when search is unavailable.
 */
export function GamePickerExtras({
  otherGameErrors,
  otherGameErrorId,
}: {
  otherGameErrors?: string[];
  otherGameErrorId: string;
}) {
  const statusID = useId();
  const enhanced = useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<GameSearchMatch[]>([]);
  const [picked, setPicked] = useState<GameSearchMatch[]>([]);
  const [status, setStatus] = useState<
    "idle" | "loading" | "success" | "error" | "limited"
  >("idle");

  useEffect(() => {
    const normalizedQuery = query.trim();
    if (normalizedQuery.length < 2) {
      setMatches([]);
      setStatus("idle");
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setStatus("loading");
      try {
        const search = new URLSearchParams({ q: normalizedQuery });
        const response = await fetch(`/api/games/igdb-search?${search}`, {
          signal: controller.signal,
        });
        if (response.status === 429) {
          setMatches([]);
          setStatus("limited");
          return;
        }
        if (!response.ok) throw new Error("game search failed");
        const parsed = gameSearchResponseSchema.safeParse(
          await response.json(),
        );
        if (!parsed.success) throw new Error("invalid game search response");
        setMatches(parsed.data.games);
        setStatus("success");
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError")
          return;
        setMatches([]);
        setStatus("error");
      }
    }, searchDelayMilliseconds);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const statusMessage =
    status === "loading"
      ? "Searching games…"
      : status === "error"
        ? "Game search is unavailable. Type the game's name below instead."
        : status === "limited"
          ? "Too many searches. Wait a minute, then search again."
          : query.trim().length < 2
            ? "Enter at least two characters to search."
            : matches.length === 0
              ? "No games found. Type the game's name below instead."
              : `${matches.length} game${matches.length === 1 ? "" : "s"} found.`;

  return (
    <>
      {enhanced ? (
        <div className="game-picker">
          <label>
            Search for another game
            <input
              aria-describedby={statusID}
              autoComplete="off"
              maxLength={100}
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="Search by game name"
              type="search"
              value={query}
            />
          </label>
          <p
            aria-live="polite"
            className={
              status === "error" || status === "limited"
                ? "form-error"
                : "form-help"
            }
            id={statusID}
            role="status"
          >
            {statusMessage}
          </p>
          {matches.length > 0 ? (
            <ul aria-label="Game search results" className="game-picker__list">
              {matches.map((match) => (
                <li key={match.igdb_id}>
                  <span>{matchTitle(match)}</span>
                  <button
                    className="button button--secondary"
                    disabled={picked.some(
                      (game) => game.igdb_id === match.igdb_id,
                    )}
                    onClick={() => setPicked((games) => [...games, match])}
                    type="button"
                  >
                    Add<span className="visually-hidden"> {match.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {picked.length > 0 ? (
            <ul aria-label="Added games" className="game-picker__list">
              {picked.map((game) => (
                <li key={game.igdb_id}>
                  <span>{matchTitle(game)}</span>
                  {/* A game the catalog holds is submitted by its catalog ID. */}
                  <input
                    name={game.game_id ? "game_ids" : "igdb_game_ids"}
                    type="hidden"
                    value={game.game_id ?? game.igdb_id}
                  />
                  <button
                    className="button button--secondary"
                    onClick={() =>
                      setPicked((games) =>
                        games.filter((item) => item.igdb_id !== game.igdb_id),
                      )
                    }
                    type="button"
                  >
                    Remove
                    <span className="visually-hidden"> {game.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      <label>
        Game not listed?
        <input
          aria-describedby={
            otherGameErrors?.length ? otherGameErrorId : undefined
          }
          aria-invalid={otherGameErrors?.length ? true : undefined}
          maxLength={100}
          name="other_game"
          placeholder="Type the game's name"
        />
        <span className="form-help">
          It is added to this page only. It will not appear in the list for
          other people.
        </span>
        {otherGameErrors?.length ? (
          <span className="form-error" id={otherGameErrorId}>
            {otherGameErrors.join(" ")}
          </span>
        ) : null}
      </label>
    </>
  );
}
