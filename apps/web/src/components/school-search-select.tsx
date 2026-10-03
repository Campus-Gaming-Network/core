import {
  useEffect,
  useId,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import {
  schoolsResponseDtoSchema,
  type SchoolDTO,
} from "../features/school-slice/contracts";

const searchDelayMilliseconds = 250;

// Server rendering and hydration see `false`, so the markup matches; a client
// render of a component that is mounted later (a remount after navigation)
// sees `true` at once instead of flashing the no-JavaScript select first.
const subscribeToNothing = () => () => {};

/** The school fields a picker needs; callers may hold a larger school DTO. */
export type SchoolOption = Pick<
  SchoolDTO,
  "id" | "name" | "slug" | "city" | "state"
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
 * native form field. Before hydration, and without JavaScript, it renders a
 * plain select of the schools the server loaded; pair it with
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
  const enhanced = useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );
  const [query, setQuery] = useState(initialQuery);
  const [selectedValue, setSelectedValue] = useState(defaultValue);
  const [retainedSchool, setRetainedSchool] = useState(defaultSchool);
  const [schools, setSchools] = useState(initialSchools);
  const [status, setStatus] = useState<
    "idle" | "loading" | "success" | "error"
  >(
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
  }, [enhanced, query]);

  if (!enhanced) {
    return (
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
  }

  const statusMessage =
    status === "loading"
      ? "Searching schools…"
      : status === "error"
        ? "We couldn’t load schools. Try another search."
        : query.trim().length < 2
          ? "Enter at least two characters to search."
          : schools.length === 0
            ? "No schools found."
            : `${schools.length} school${schools.length === 1 ? "" : "s"} found.`;

  return (
    <div className={className}>
      <label>
        Search schools
        <input
          aria-describedby={statusID}
          autoComplete="off"
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder="Search by school name"
          type="search"
          value={query}
        />
      </label>
      <p
        aria-live="polite"
        className={status === "error" ? "form-error" : "form-help"}
        id={statusID}
        role="status"
      >
        {statusMessage}
      </p>
      <label>
        {label}
        <select
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          name={name}
          onChange={(event) => {
            const value = event.currentTarget.value;
            setSelectedValue(value);
            setRetainedSchool(
              options.find((school) => school[valueField] === value),
            );
          }}
          required={required}
          value={selectedValue}
        >
          <option value="">{emptyLabel}</option>
          {options.map((school) => (
            <option key={school.id} value={school[valueField]}>
              {schoolOptionLabel(school)}
            </option>
          ))}
        </select>
      </label>
    </div>
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
