import { useHydrated } from "@tanstack/react-router";
import { Search, X } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { isListboxKey, nextActiveIndex } from "./listbox-navigation";
import {
  searchFilterMessage,
  type SearchFilterState,
} from "./search-filter-status";

const searchDelayMilliseconds = 250;

/** One choice in a search filter: what it submits and how it reads. */
export type SearchFilterOption = {
  value: string;
  label: string;
  /** A second line in the results, such as a school's city. */
  detail?: string;
  /** A small logo, cover, or initial; decoration only. */
  mark: ReactNode;
};

/**
 * A directory filter that searches a long list (schools, games) instead of
 * listing it: a rounded search box whose results float under it, and, once
 * something is chosen, a blue applied filter with its mark and a clear
 * button. Choosing or clearing submits the surrounding `FilterForm`, which
 * applies it at once.
 *
 * The search box is rendered from the first paint, so nothing swaps when the
 * page hydrates; it starts working then. Without JavaScript it is hidden by
 * the `live-only` rule in the document head, and the `<noscript>` select of
 * `fallbackOptions` (the chosen one and any no-JavaScript search matches)
 * takes its place and its field name.
 */
export function SearchFilter({
  chosen,
  fallbackOptions,
  label,
  minimumLength,
  name,
  noun,
  placeholder,
  search,
}: {
  chosen?: SearchFilterOption;
  fallbackOptions: SearchFilterOption[];
  /** The filter's name, such as "School". */
  label: string;
  /** The shortest query worth searching. */
  minimumLength: number;
  /** The submitted field. */
  name: string;
  /** Plural, for messages: "schools". */
  noun: string;
  placeholder: string;
  /** Looks up matches; pass a module-level function so it stays the same. */
  search: (query: string, signal: AbortSignal) => Promise<SearchFilterOption[]>;
}) {
  const hydrated = useHydrated();
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const clearRef = useRef<HTMLButtonElement>(null);
  const valueRef = useRef<HTMLInputElement>(null);
  const focusAfter = useRef<"input" | "clear" | undefined>(undefined);
  const submitAfter = useRef(false);
  const [selected, setSelected] = useState(chosen);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchFilterOption[]>([]);
  const [state, setState] = useState<SearchFilterState>("idle");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [retry, setRetry] = useState(0);

  const trimmed = query.trim();
  const searching = trimmed.length >= minimumLength;

  useEffect(() => {
    setActiveIndex(-1);
    if (!searching) {
      setResults([]);
      setState("idle");
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setState("loading");
      try {
        setResults(await search(trimmed, controller.signal));
        setState("success");
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError")
          return;
        setResults([]);
        setState("error");
      }
    }, searchDelayMilliseconds);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [trimmed, searching, retry, search]);

  // Focus moves first, so the form remembers the right control to return to
  // once it applies the change.
  useEffect(() => {
    if (focusAfter.current === "input") inputRef.current?.focus();
    if (focusAfter.current === "clear") clearRef.current?.focus();
    focusAfter.current = undefined;
    if (!submitAfter.current) return;
    submitAfter.current = false;
    valueRef.current?.form?.requestSubmit();
  });

  useEffect(() => {
    if (activeIndex < 0) return;
    document
      .getElementById(`${id}-option-${activeIndex}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, id]);

  function choose(option: SearchFilterOption) {
    setSelected(option);
    setQuery("");
    setOpen(false);
    focusAfter.current = "clear";
    submitAfter.current = true;
  }

  function clear() {
    setSelected(undefined);
    focusAfter.current = "input";
    submitAfter.current = true;
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const key = event.key;
    if (isListboxKey(key) && results.length > 0) {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) =>
        nextActiveIndex(current, results.length, key),
      );
    } else if (key === "Enter") {
      // Enter chooses; it never submits the form from the search box.
      event.preventDefault();
      const option = results[activeIndex];
      if (open && option) choose(option);
    } else if (key === "Escape" && (query || open)) {
      event.preventDefault();
      setQuery("");
      setOpen(false);
    }
  }

  const showList = open && searching && results.length > 0;
  const message = searchFilterMessage({
    count: results.length,
    minimumLength,
    noun,
    query,
    state,
  });
  const showNote =
    open &&
    searching &&
    (state === "error" || (state === "success" && results.length === 0));
  const refocusKey = `${name}-search`;

  return (
    <div className="search-filter">
      <div className="search-filter__live live-only">
        {/* Named only once the page runs: without JavaScript the noscript
            select below submits the value instead. */}
        <input
          name={hydrated ? name : undefined}
          ref={valueRef}
          type="hidden"
          value={selected?.value ?? ""}
        />
        {selected ? (
          <div className="search-filter__chosen">
            {selected.mark}
            <span className="search-filter__name">
              <span className="visually-hidden">{label}: </span>
              {selected.label}
            </span>
            <button
              aria-label={`Clear ${label.toLowerCase()}: ${selected.label}`}
              className="search-filter__clear"
              data-refocus={refocusKey}
              onClick={clear}
              ref={clearRef}
              type="button"
            >
              <X aria-hidden="true" size={16} strokeWidth={2} />
            </button>
          </div>
        ) : (
          <>
            <label className="visually-hidden" htmlFor={`${id}-input`}>
              {label}
            </label>
            <Search
              aria-hidden="true"
              className="search-filter__icon"
              size={18}
              strokeWidth={2}
            />
            <input
              aria-activedescendant={
                showList && activeIndex >= 0
                  ? `${id}-option-${activeIndex}`
                  : undefined
              }
              aria-autocomplete="list"
              aria-controls={`${id}-list`}
              aria-describedby={`${id}-status`}
              aria-expanded={showList}
              autoComplete="off"
              data-refocus={refocusKey}
              id={`${id}-input`}
              maxLength={100}
              onBlur={() => setOpen(false)}
              onChange={(event) => {
                setQuery(event.currentTarget.value);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              onKeyDown={onKeyDown}
              placeholder={placeholder}
              ref={inputRef}
              role="combobox"
              type="search"
              value={query}
            />
            <ul
              aria-busy={state === "loading"}
              aria-label={`${label} results`}
              className="search-filter__options"
              hidden={!showList}
              id={`${id}-list`}
              role="listbox"
            >
              {showList
                ? results.map((option, index) => (
                    <li
                      aria-selected={index === activeIndex}
                      className="search-filter__option"
                      id={`${id}-option-${index}`}
                      key={option.value}
                      onClick={() => choose(option)}
                      // Keep focus in the search box while clicking.
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseMove={() => setActiveIndex(index)}
                      role="option"
                    >
                      {option.mark}
                      <span className="search-filter__option-text">
                        <strong>{option.label}</strong>
                        {option.detail ? <span>{option.detail}</span> : null}
                      </span>
                    </li>
                  ))
                : null}
            </ul>
            {showNote ? (
              <div aria-hidden="true" className="search-filter__note">
                {message}
                {state === "error" ? (
                  <button
                    className="search-filter__retry"
                    onClick={() => setRetry((count) => count + 1)}
                    onMouseDown={(event) => event.preventDefault()}
                    type="button"
                  >
                    Try again
                  </button>
                ) : null}
              </div>
            ) : null}
          </>
        )}
        <p
          aria-live="polite"
          className="visually-hidden"
          id={`${id}-status`}
          role="status"
        >
          {selected ? `${label}: ${selected.label}.` : message}
        </p>
      </div>
      <noscript>
        <label className="filter-pill" data-active={chosen ? "" : undefined}>
          <span className="filter-pill__name">{label}</span>
          <select defaultValue={chosen?.value ?? ""} name={name}>
            <option value="">Any</option>
            {fallbackOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.detail
                  ? `${option.label} — ${option.detail}`
                  : option.label}
              </option>
            ))}
          </select>
        </label>
      </noscript>
    </div>
  );
}

/**
 * The no-JavaScript choices for a search filter: the chosen option, so it
 * stays selected, then the `*_q` search matches, each once.
 */
export function searchFilterFallback(
  chosen: SearchFilterOption | undefined,
  matches: SearchFilterOption[],
): SearchFilterOption[] {
  return [
    ...(chosen ? [chosen] : []),
    ...matches.filter((option) => option.value !== chosen?.value),
  ];
}
