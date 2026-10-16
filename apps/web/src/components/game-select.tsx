import { useHydrated } from "@tanstack/react-router";
import { X } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  gameSearchResponseSchema,
  type GameSearchMatch,
} from "../features/game-picker/contracts";
import { GameTile } from "../features/game-picker/game-tile";
import {
  gameMatchCoverURL,
  gameMatchTitle,
  maximumPickedGames,
} from "../features/game-picker/picker-helpers";
import {
  catalogGameMatches,
  chosenGameFields,
  gameSelectMessage,
  type CatalogGame,
  type ChosenGame,
} from "../features/game-picker/game-select-helpers";
import { FieldError } from "./enhanced-mutation";
import { isListboxKey, nextActiveIndex } from "./listbox-navigation";

const searchDelayMilliseconds = 250;

type Option =
  | { kind: "catalog"; game: CatalogGame }
  | { kind: "igdb"; match: GameSearchMatch };

/**
 * One field for a form's games. Typing shows the games already on Campus
 * Gaming Network at once and, after a pause, more games from IGDB; Enter or a
 * click adds one, and every chosen game is listed below with its cover and a
 * Remove button. A catalog game is submitted as `game_ids`, an IGDB game the
 * catalog does not hold as `igdb_game_ids` (at most five), so the server
 * contract is unchanged. The search field is rendered from the first paint,
 * so nothing swaps when the page hydrates. Without JavaScript it is hidden
 * (the `live-only` rule in the document head) and the form's own `fallback`
 * control (a multi-select or checkboxes) takes its place.
 * The "Game not listed?" field works either way.
 */
export function GameSelect({
  catalog,
  errorId,
  errors,
  fallback,
  initialGames = [],
  label,
  optional = false,
  otherGameErrorId,
  otherGameErrors,
}: {
  catalog: CatalogGame[];
  errorId: string;
  errors?: string[];
  fallback: ReactNode;
  /** The games already chosen (an edited event's), kept even if retired. */
  initialGames?: CatalogGame[];
  label: string;
  /** Mark the field "(optional)": an event may have no game, a team may not. */
  optional?: boolean;
  otherGameErrorId: string;
  otherGameErrors?: string[];
}) {
  const enhanced = useHydrated();
  const listID = useId();
  const statusID = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [igdbMatches, setIGDBMatches] = useState<GameSearchMatch[]>([]);
  const [searchState, setSearchState] = useState<
    "idle" | "loading" | "done" | "error" | "limited"
  >("idle");
  const [chosen, setChosen] = useState<ChosenGame[]>(() =>
    initialGames.map((game) => ({ kind: "catalog", game })),
  );
  const [announcement, setAnnouncement] = useState("");

  const trimmed = query.trim();
  const chosenCatalogIDs = new Set(
    chosen.flatMap((item) => (item.kind === "catalog" ? [item.game.id] : [])),
  );
  const chosenIGDBIDs = new Set(
    chosen.flatMap((item) =>
      item.kind === "igdb" ? [item.match.igdb_id] : [],
    ),
  );
  const igdbCount = chosenIGDBIDs.size;
  const catalogOptions = catalogGameMatches(catalog, trimmed);
  const catalogIDs = new Set(catalog.map((game) => game.id));
  // An IGDB result the catalog already holds is offered once, as the catalog
  // game, so it is not added twice.
  const igdbOptions = igdbMatches.filter(
    (match) => !match.game_id || !catalogIDs.has(match.game_id),
  );
  const options: Option[] = [
    ...catalogOptions.map((game) => ({ kind: "catalog" as const, game })),
    ...igdbOptions.map((match) => ({ kind: "igdb" as const, match })),
  ];
  const showList = open && options.length > 0;

  useEffect(() => {
    setActiveIndex(-1);
    if (trimmed.length < 2) {
      setIGDBMatches([]);
      setSearchState("idle");
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearchState("loading");
      try {
        const response = await fetch(
          `/api/games/igdb-search?${new URLSearchParams({ q: trimmed })}`,
          { signal: controller.signal },
        );
        if (response.status === 429) {
          setIGDBMatches([]);
          setSearchState("limited");
          return;
        }
        if (!response.ok) throw new Error("game search failed");
        const parsed = gameSearchResponseSchema.safeParse(
          await response.json(),
        );
        if (!parsed.success) throw new Error("invalid game search response");
        setIGDBMatches(parsed.data.games);
        setSearchState("done");
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError")
          return;
        setIGDBMatches([]);
        setSearchState("error");
      }
    }, searchDelayMilliseconds);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed]);

  useEffect(() => {
    if (activeIndex < 0) return;
    document
      .getElementById(`${listID}-option-${activeIndex}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, listID]);

  function isChosen(option: Option): boolean {
    return option.kind === "catalog"
      ? chosenCatalogIDs.has(option.game.id)
      : chosenIGDBIDs.has(option.match.igdb_id);
  }

  function isBlocked(option: Option): boolean {
    return option.kind === "igdb" && igdbCount >= maximumPickedGames;
  }

  function add(option: Option) {
    if (isChosen(option) || isBlocked(option)) return;
    const name =
      option.kind === "catalog" ? option.game.name : option.match.name;
    setChosen((current) => [
      ...current,
      option.kind === "catalog"
        ? { kind: "catalog", game: option.game }
        : { kind: "igdb", match: option.match },
    ]);
    setAnnouncement(`${name} added.`);
    setQuery("");
    setOpen(false);
  }

  function remove(item: ChosenGame) {
    setChosen((current) => current.filter((other) => other !== item));
    setAnnouncement(
      `${item.kind === "catalog" ? item.game.name : item.match.name} removed.`,
    );
    inputRef.current?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const key = event.key;
    if (isListboxKey(key) && options.length > 0) {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) =>
        nextActiveIndex(current, options.length, key),
      );
    } else if (key === "Enter") {
      // Enter adds the highlighted game; it never submits the form.
      event.preventDefault();
      const option = options[activeIndex];
      if (showList && option) add(option);
    } else if (key === "Escape" && (query || open)) {
      event.preventDefault();
      setQuery("");
      setOpen(false);
    }
  }

  const message =
    announcement ||
    gameSelectMessage({
      query: trimmed,
      catalogCount: catalogOptions.length,
      igdbState: searchState,
      igdbCount: igdbOptions.length,
      igdbChosen: igdbCount,
    });

  return (
    <>
      <div className="game-picker picker live-only">
        <label className="picker__label" htmlFor={`${listID}-input`}>
          {label}
          {optional ? (
            <span className="field-optional"> (optional)</span>
          ) : null}
        </label>
        <p className="form-help picker__hint">
          Search games on Campus Gaming Network and IGDB. Add as many as you
          need.
        </p>
        <input
          aria-activedescendant={
            showList && activeIndex >= 0
              ? `${listID}-option-${activeIndex}`
              : undefined
          }
          aria-autocomplete="list"
          aria-controls={`${listID}-list`}
          aria-describedby={[statusID, errors?.length ? errorId : ""]
            .filter(Boolean)
            .join(" ")}
          aria-expanded={showList}
          aria-invalid={errors?.length ? true : undefined}
          autoComplete="off"
          id={`${listID}-input`}
          maxLength={100}
          onBlur={() => setOpen(false)}
          onChange={(event) => {
            setQuery(event.currentTarget.value);
            setOpen(true);
            setAnnouncement("");
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search for a game"
          ref={inputRef}
          role="combobox"
          type="search"
          value={query}
        />
        <p
          aria-live="polite"
          className="picker__status"
          id={statusID}
          role="status"
        >
          {message}
        </p>
        <ul
          aria-busy={searchState === "loading"}
          aria-label="Games"
          className="picker__options"
          hidden={!showList}
          id={`${listID}-list`}
          role="listbox"
        >
          {showList
            ? options.map((option, index) => {
                const chosenAlready = isChosen(option);
                const blocked = !chosenAlready && isBlocked(option);
                const groupStart =
                  index === 0 || options[index - 1]?.kind !== option.kind;
                const coverURL =
                  option.kind === "catalog"
                    ? option.game.coverURL
                    : gameMatchCoverURL(option.match);
                const optionKey =
                  option.kind === "catalog"
                    ? `catalog-${option.game.id}`
                    : `igdb-${option.match.igdb_id}`;
                return [
                  groupStart ? (
                    <li
                      className="picker__group"
                      key={`${option.kind}-group`}
                      role="presentation"
                    >
                      {option.kind === "catalog"
                        ? "On Campus Gaming Network"
                        : "More from IGDB"}
                    </li>
                  ) : null,
                  <li
                    aria-disabled={chosenAlready || blocked || undefined}
                    aria-selected={index === activeIndex}
                    className="picker__option"
                    id={`${listID}-option-${index}`}
                    key={optionKey}
                    // Keep focus in the search box while clicking.
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => add(option)}
                    onMouseMove={() => setActiveIndex(index)}
                    role="option"
                  >
                    <GameTile coverURL={coverURL} />
                    <span className="picker__option-text">
                      {option.kind === "catalog"
                        ? option.game.name
                        : gameMatchTitle(option.match)}
                    </span>
                    <span className="picker__option-action">
                      {chosenAlready
                        ? "Added"
                        : blocked
                          ? "Limit reached"
                          : "Add"}
                    </span>
                  </li>,
                ];
              })
            : null}
        </ul>
        {chosen.length > 0 ? (
          <ul aria-label="Chosen games" className="picker__chosen">
            {chosen.map((item) => {
              const field = chosenGameFields(item);
              const name =
                item.kind === "catalog" ? item.game.name : item.match.name;
              return (
                <li key={`${field.name}-${field.value}`}>
                  <GameTile
                    coverURL={
                      item.kind === "catalog"
                        ? item.game.coverURL
                        : gameMatchCoverURL(item.match)
                    }
                  />
                  <span className="picker__option-text">
                    {item.kind === "catalog"
                      ? name
                      : gameMatchTitle(item.match)}
                  </span>
                  {/* Named only once the page runs; without JavaScript
                        the fallback control submits the games. */}
                  <input
                    name={enhanced ? field.name : undefined}
                    type="hidden"
                    value={field.value}
                  />
                  <button
                    className="picker__remove"
                    onClick={() => remove(item)}
                    type="button"
                  >
                    <X aria-hidden="true" size={14} strokeWidth={2} />
                    Remove
                    <span className="visually-hidden"> {name}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
        <FieldError id={errorId} messages={errors} />
      </div>
      <noscript>{fallback}</noscript>
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
