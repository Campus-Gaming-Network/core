import { useHydrated } from "@tanstack/react-router";
import { GraduationCap } from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  schoolsResponseDtoSchema,
  type SchoolDTO,
} from "../features/school-slice/contracts";
import { schoolLocation } from "../features/school-slice/presentation";
import { isListboxKey, nextActiveIndex } from "./listbox-navigation";
import { SchoolMark } from "./school-mark";
import { schoolSearchMessage } from "./school-search-status";
import type { SearchFilterState } from "./search-filter-status";

const searchDelayMilliseconds = 250;

/** The school fields a picker needs; callers may hold a larger school DTO. */
export type SchoolOption = Pick<
  SchoolDTO,
  "id" | "name" | "slug" | "city" | "state" | "logo_url"
>;

type Props = {
  /** The form field the select submits. */
  name: string;
  label: string;
  /** Text of the option that clears the choice. */
  emptyLabel: string;
  /** Which school property the select submits as its value. */
  valueField: "id" | "slug";
  defaultValue: string;
  /** Always offered as an option so the current choice stays visible. */
  defaultSchool?: SchoolOption;
  initialQuery: string;
  initialSchools: SchoolOption[];
  initialSearchFailed: boolean;
  className?: string;
  required?: boolean;
  describedBy?: string;
  invalid?: boolean;
};

/**
 * Searches the school catalog by name and submits the chosen school in a
 * native form field. The search field is rendered from the first paint, so
 * nothing swaps when the page hydrates. Without JavaScript a plain select of
 * the schools the server loaded takes its place; pair it with
 * NoScriptSchoolSearch so people can load a different set.
 */
export function SchoolSearchSelect({
  name,
  label,
  emptyLabel,
  valueField,
  defaultValue,
  defaultSchool,
  initialQuery,
  initialSchools,
  initialSearchFailed,
  className,
  required,
  describedBy,
  invalid,
}: Props) {
  const statusID = useId();
  // False on the server and until hydration: the search waits for it, and
  // the hidden field takes its name only then.
  const enhanced = useHydrated();
  const [query, setQuery] = useState(initialQuery);
  const [selectedValue, setSelectedValue] = useState(defaultValue);
  const [retainedSchool, setRetainedSchool] = useState(defaultSchool);
  const [schools, setSchools] = useState(initialSchools);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  // What the last choice said; replaces the search status so a screen reader
  // hears it.
  const [announcement, setAnnouncement] = useState("");
  const [retry, setRetry] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const changeRef = useRef<HTMLButtonElement>(null);

  // Where focus goes once the swap between search box and chosen card renders.
  const focusAfter = useRef<"input" | "change" | undefined>(undefined);
  const [status, setStatus] = useState<SearchFilterState>(
    initialSearchFailed
      ? "error"
      : initialQuery.length >= 2
        ? "success"
        : "idle",
  );
  const options = useMemo(
    () => mergeSchools([defaultSchool, retainedSchool], schools),
    [defaultSchool, retainedSchool, schools],
  );

  useEffect(() => {
    if (!enhanced) return;
    const normalizedQuery = query.trim();
    setActiveIndex(-1);
    if (normalizedQuery.length < 2) {
      setSchools([]);
      setStatus("idle");
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setStatus("loading");
      try {
        const search = new URLSearchParams({ q: normalizedQuery, limit: "50" });
        const response = await fetch(`/api/schools?${search.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("school search failed");
        const parsed = schoolsResponseDtoSchema.safeParse(
          await response.json(),
        );
        if (!parsed.success) throw new Error("invalid school search response");
        setSchools(parsed.data.schools);
        setStatus("success");
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError")
          return;
        setSchools([]);
        setStatus("error");
      }
    }, searchDelayMilliseconds);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [enhanced, query, retry]);

  useEffect(() => {
    if (focusAfter.current === "input") inputRef.current?.focus();
    if (focusAfter.current === "change") changeRef.current?.focus();
    focusAfter.current = undefined;
  });

  // The visible search box is not the submitted field, so a required choice
  // is enforced here: the form will not submit until a school is chosen.
  useEffect(() => {
    inputRef.current?.setCustomValidity(
      required && !selectedValue ? "Choose a school from the results." : "",
    );
  });

  useEffect(() => {
    if (activeIndex < 0) return;
    document
      .getElementById(`${statusID}-option-${activeIndex}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, statusID]);

  // Without JavaScript the live field is hidden (the `live-only` rule in the
  // document head) and this select takes its place and its field name.
  const fallback = (
    <label>
      {label}
      <select
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        defaultValue={defaultValue}
        name={name}
        required={required}
      >
        <option value="">{emptyLabel}</option>
        {options.map((school) => (
          <option key={school.id} value={school[valueField]}>
            {schoolOptionLabel(school)}
          </option>
        ))}
      </select>
      <span className="form-help">
        Use the school search above to load more choices.
      </span>
      {initialSearchFailed ? (
        <span className="form-error">
          We couldn’t load schools. Try the search again.
        </span>
      ) : null}
    </label>
  );

  const chosenSchool = selectedValue
    ? options.find((school) => school[valueField] === selectedValue)
    : undefined;
  const searching = query.trim().length >= 2;
  const showList = open && searching && schools.length > 0;
  const message =
    announcement ||
    schoolSearchMessage({ state: status, query, count: schools.length });
  const tone =
    announcement || !searching
      ? "hint"
      : status === "success" && schools.length === 0
        ? "empty"
        : status;

  function choose(school: SchoolOption) {
    setSelectedValue(school[valueField]);
    setRetainedSchool(school);
    setQuery("");
    setOpen(false);
    setAnnouncement(`${school.name} chosen.`);
    focusAfter.current = "change";
  }

  function change() {
    setSelectedValue("");
    setAnnouncement("Choice cleared. Type to search for a school.");
    focusAfter.current = "input";
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const key = event.key;
    if (isListboxKey(key) && searching && schools.length > 0) {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) =>
        nextActiveIndex(current, schools.length, key),
      );
    } else if (key === "Enter" && searching) {
      // Enter chooses; it never submits the form from the search box.
      event.preventDefault();
      const school = schools[activeIndex];
      if (open && school) choose(school);
    } else if (key === "Escape" && (query || open)) {
      event.preventDefault();
      setQuery("");
      setOpen(false);
      setAnnouncement("");
    }
  }

  const describedByIDs = [describedBy, statusID].filter(Boolean).join(" ");

  return (
    <>
      <div
        className={`school-select picker live-only ${className ?? ""}`.trim()}
      >
        {/* Named only once the page runs, so the no-JavaScript select below is
          the one field that submits without it. */}
        <input
          name={enhanced ? name : undefined}
          type="hidden"
          value={selectedValue}
        />
        {selectedValue ? (
          <div className="school-select__chosen">
            <span className="picker__label">{label}</span>
            <div className="school-select__card">
              {chosenSchool ? (
                <SchoolMark
                  className="school-select__mark"
                  logoURL={chosenSchool.logo_url}
                  name={chosenSchool.name}
                  size={32}
                  slug={chosenSchool.slug}
                />
              ) : (
                <GraduationCap
                  aria-hidden="true"
                  size={20}
                  strokeWidth={1.75}
                />
              )}
              <span className="school-select__text">
                <strong>{chosenSchool?.name ?? "Selected school"}</strong>
                {chosenSchool && schoolLocation(chosenSchool, "") ? (
                  <span>{schoolLocation(chosenSchool, "")}</span>
                ) : null}
              </span>
              <button
                className="picker__remove"
                onClick={change}
                ref={changeRef}
                type="button"
              >
                Change
                <span className="visually-hidden"> {label.toLowerCase()}</span>
              </button>
            </div>
          </div>
        ) : (
          <>
            <label className="picker__label" htmlFor={`${statusID}-input`}>
              {label}
            </label>
            <input
              aria-activedescendant={
                showList && activeIndex >= 0
                  ? `${statusID}-option-${activeIndex}`
                  : undefined
              }
              aria-autocomplete="list"
              aria-controls={`${statusID}-list`}
              aria-describedby={describedByIDs}
              aria-expanded={showList}
              aria-invalid={invalid || undefined}
              aria-required={required || undefined}
              autoComplete="off"
              id={`${statusID}-input`}
              onBlur={() => setOpen(false)}
              onChange={(event) => {
                setQuery(event.currentTarget.value);
                setOpen(true);
                setAnnouncement("");
              }}
              onFocus={() => setOpen(true)}
              onKeyDown={onKeyDown}
              placeholder={
                required
                  ? "Search by school name"
                  : `${emptyLabel}: type to search`
              }
              ref={inputRef}
              role="combobox"
              enterKeyHint="search"
              type="search"
              value={query}
            />
          </>
        )}
        <p
          aria-live="polite"
          className={
            selectedValue ? "picker__status visually-hidden" : "picker__status"
          }
          data-tone={tone}
          id={statusID}
          role="status"
        >
          {message}
        </p>
        {!selectedValue ? (
          <ul
            aria-busy={status === "loading"}
            aria-label={`${label} search results`}
            className="picker__options"
            hidden={!showList}
            id={`${statusID}-list`}
            role="listbox"
          >
            {showList
              ? schools.map((school, index) => (
                  <li
                    aria-selected={index === activeIndex}
                    className="picker__option"
                    id={`${statusID}-option-${index}`}
                    key={school.id}
                    onClick={() => choose(school)}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseMove={() => setActiveIndex(index)}
                    role="option"
                  >
                    <SchoolMark
                      className="school-select__mark"
                      logoURL={school.logo_url}
                      name={school.name}
                      size={32}
                      slug={school.slug}
                    />
                    <span className="picker__option-text">
                      <strong>{school.name}</strong>
                      {schoolLocation(school, "") ? (
                        <span>{schoolLocation(school, "")}</span>
                      ) : null}
                    </span>
                  </li>
                ))
              : null}
          </ul>
        ) : null}
        {status === "error" && searching && !chosenSchool ? (
          <button
            className="picker__remove"
            onClick={() => setRetry((count) => count + 1)}
            type="button"
          >
            Try again
          </button>
        ) : null}
      </div>
      <noscript>{fallback}</noscript>
    </>
  );
}

/**
 * A no-JavaScript school search: a native GET form that reloads the page with
 * `school_q`. `preserve` carries the page's other filters through the search.
 */
export function NoScriptSchoolSearch({
  action,
  query,
  preserve = {},
}: {
  action: string;
  query: string;
  preserve?: Record<string, string | undefined>;
}) {
  return (
    <noscript>
      <form action={action} className="search-bar compact" method="get">
        {Object.entries(preserve).map(([name, value]) =>
          value ? (
            <input key={name} name={name} type="hidden" value={value} />
          ) : null,
        )}
        <label>
          Search schools
          <input
            defaultValue={query}
            name="school_q"
            placeholder="Search by school name"
            required
            enterKeyHint="search"
            type="search"
          />
        </label>
        <button type="submit">Search</button>
      </form>
    </noscript>
  );
}

function mergeSchools(
  pinned: Array<SchoolOption | undefined>,
  schools: SchoolOption[],
): SchoolOption[] {
  const unique = new Map<string, SchoolOption>();
  for (const school of pinned) if (school) unique.set(school.id, school);
  for (const school of schools) unique.set(school.id, school);
  return [...unique.values()];
}

function schoolOptionLabel(school: SchoolOption): string {
  const location = [school.city, school.state].filter(Boolean).join(", ");
  return location ? `${school.name} — ${location}` : school.name;
}
