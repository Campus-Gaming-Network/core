import { useEffect, useId, useMemo, useState } from "react";
import type { EventFormSchoolDTO } from "./contracts.js";
import { eventFormSchoolsResponseDtoSchema } from "./contracts.js";

const searchDelayMilliseconds = 250;

type Props = {
  defaultSchoolID: string;
  defaultSchool?: EventFormSchoolDTO;
  initialQuery: string;
  initialSchools: EventFormSchoolDTO[];
  initialSearchFailed: boolean;
  describedBy?: string;
  invalid?: boolean;
};

export function EventSchoolPicker({
  defaultSchoolID,
  defaultSchool,
  initialQuery,
  initialSchools,
  initialSearchFailed,
  describedBy,
  invalid
}: Props) {
  const statusID = useId();
  const [enhanced, setEnhanced] = useState(false);
  const [query, setQuery] = useState(initialQuery);
  const [selectedSchoolID, setSelectedSchoolID] = useState(defaultSchoolID);
  const [schools, setSchools] = useState(initialSchools);
  const [status, setStatus] = useState<
    "idle" | "loading" | "success" | "error"
  >(initialSearchFailed ? "error" : initialQuery.length >= 2 ? "success" : "idle");
  const options = useMemo(
    () => mergeSchools(defaultSchool, schools),
    [defaultSchool, schools]
  );

  useEffect(() => setEnhanced(true), []);

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
          signal: controller.signal
        });
        if (!response.ok) throw new Error("school search failed");
        const parsed = eventFormSchoolsResponseDtoSchema.safeParse(
          await response.json()
        );
        if (!parsed.success) throw new Error("invalid school search response");
        setSchools(parsed.data.schools);
        setStatus("success");
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
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
        Host school
        <select
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          defaultValue={defaultSchoolID}
          name="host_school_id"
          required
        >
          <option value="">Choose a host school</option>
          {options.map((school) => (
            <option key={school.id} value={school.id}>
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
    <div className="event-school-picker">
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
        Host school
        <select
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          name="host_school_id"
          onChange={(event) => setSelectedSchoolID(event.currentTarget.value)}
          required
          value={selectedSchoolID}
        >
          <option value="">Choose a host school</option>
          {options.map((school) => (
            <option key={school.id} value={school.id}>
              {schoolOptionLabel(school)}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

export function NoScriptSchoolSearch({
  action,
  query
}: {
  action: string;
  query: string;
}) {
  return (
    <noscript>
      <form action={action} className="search-bar compact" method="get">
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
  selected: EventFormSchoolDTO | undefined,
  schools: EventFormSchoolDTO[]
): EventFormSchoolDTO[] {
  const unique = new Map<string, EventFormSchoolDTO>();
  if (selected) unique.set(selected.id, selected);
  for (const school of schools) unique.set(school.id, school);
  return [...unique.values()];
}

function schoolOptionLabel(school: EventFormSchoolDTO): string {
  const location = [school.city, school.state].filter(Boolean).join(", ");
  return location ? `${school.name} — ${location}` : school.name;
}
