import { useEffect, useId, useMemo, useState } from "react";
import type { SchoolDTO } from "../school-slice/contracts";

type SchoolPickerProps = {
  schools: SchoolDTO[];
  selectedSchoolId?: string;
  initialQuery?: string;
  initialSearchFailed?: boolean;
  describedBy?: string;
  invalid?: boolean;
};

export function SchoolPicker({
  schools,
  selectedSchoolId,
  initialQuery = "",
  initialSearchFailed = false,
  describedBy,
  invalid
}: SchoolPickerProps) {
  const resultsId = useId();
  const statusId = useId();
  const initialSelection = schoolSelection(selectedSchoolId, schools);
  const [enhanced, setEnhanced] = useState(false);
  const [selected, setSelected] = useState<SchoolDTO | SchoolChoice | undefined>(
    initialSelection
  );
  const [retained, setRetained] = useState(initialSelection);
  const [query, setQuery] = useState(
    initialQuery || (initialSelection ? schoolLabel(initialSelection) : "")
  );
  const [results, setResults] = useState(schools);
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">(
    initialSearchFailed ? "error" : initialQuery.trim().length >= 2 ? "success" : "idle"
  );
  const [retry, setRetry] = useState(0);
  const options = useMemo(() => mergeSchools(retained, results), [retained, results]);

  useEffect(() => setEnhanced(true), []);

  useEffect(() => {
    if (!enhanced) return;
    const value = query.trim();
    if (value.length < 2) {
      setResults([]);
      setStatus("idle");
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setStatus("loading");
      try {
        const search = new URLSearchParams({ q: value, limit: "50" });
        const response = await fetch(`/api/schools?${search}`, {
          cache: "no-store",
          signal: controller.signal
        });
        if (!response.ok) throw new Error("school search failed");
        const payload: unknown = await response.json();
        if (!isSchoolsPayload(payload)) throw new Error("invalid school search response");
        setResults(payload.schools);
        setStatus("success");
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setResults([]);
        setStatus("error");
      }
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [enhanced, query, retry]);

  if (!enhanced) {
    return (
      <label className="school-picker__fallback">
        Home school
        <select
          name="home_school_id"
          defaultValue={selected?.id ?? ""}
          required
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
        >
          <option value="">No school selected</option>
          {options.map((school) => (
            <option key={school.id} value={school.id}>{schoolLabel(school)}</option>
          ))}
        </select>
        <span className="form-help">Use the school search above to load more choices.</span>
        {initialSearchFailed ? (
          <span className="form-error">We couldn’t load schools. Try the search again.</span>
        ) : null}
      </label>
    );
  }

  const statusMessage = schoolStatus(query, results.length, status);
  const inputDescription = [describedBy, statusId].filter(Boolean).join(" ");

  return (
    <div className="school-picker">
      <label htmlFor={`${resultsId}-input`}>Search schools</label>
      <input
        id={`${resultsId}-input`}
        aria-describedby={statusId}
        autoComplete="off"
        placeholder="Search by school name"
        type="search"
        value={query}
        onChange={(event) => setQuery(event.currentTarget.value)}
      />
      <p
        className={status === "error" ? "form-error" : "form-help"}
        id={statusId}
        role="status"
        aria-live="polite"
      >
        {statusMessage}
      </p>
      {status === "error" ? (
        <button type="button" className="button button--secondary" onClick={() => setRetry((n) => n + 1)}>
          Try again
        </button>
      ) : null}
      <label htmlFor={`${resultsId}-select`}>Home school</label>
      <select
        id={`${resultsId}-select`}
        aria-describedby={inputDescription || undefined}
        aria-invalid={invalid || undefined}
        name="home_school_id"
        required
        value={selected?.id ?? ""}
        onChange={(event) => {
          const school = options.find(
            (option) => option.id === event.currentTarget.value
          );
          setSelected(school);
          if (school) setRetained(school);
        }}
      >
        <option value="">No school selected</option>
        {options.map((school) => (
          <option key={school.id} value={school.id}>
            {schoolLabel(school)}
          </option>
        ))}
      </select>
    </div>
  );
}

type SchoolChoice = { id: string; name: string; city?: string; state?: string };

function schoolSelection(selectedId: string | undefined, schools: SchoolDTO[]) {
  if (!selectedId) return undefined;
  return schools.find((school) => school.id === selectedId) ?? {
    id: selectedId,
    name: "Selected school"
  };
}

function mergeSchools(
  retained: SchoolDTO | SchoolChoice | undefined,
  schools: SchoolDTO[]
): Array<SchoolDTO | SchoolChoice> {
  return retained && !schools.some((school) => school.id === retained.id)
    ? [retained, ...schools]
    : schools;
}

function schoolLabel(school: SchoolDTO | SchoolChoice) {
  const location = schoolLocation(school);
  return location ? `${school.name} (${location})` : school.name;
}

function schoolLocation(school: Pick<SchoolChoice, "city" | "state">) {
  return [school.city, school.state].filter(Boolean).join(", ");
}

function schoolStatus(
  query: string,
  count: number,
  status: "idle" | "loading" | "success" | "error"
) {
  if (status === "loading") return "Searching schools…";
  if (status === "error") return "We couldn’t load schools. Check your connection and try again.";
  if (query.trim().length < 2) return "Type at least 2 characters to search every active school.";
  if (count === 0) return `No schools found for “${query.trim()}”.`;
  return `${count} school${count === 1 ? "" : "s"} found.`;
}

function isSchoolsPayload(value: unknown): value is { schools: SchoolDTO[] } {
  if (typeof value !== "object" || value === null || !("schools" in value)) return false;
  const schools = Reflect.get(value, "schools");
  return Array.isArray(schools) && schools.every((school) =>
    typeof school === "object" && school !== null &&
    typeof Reflect.get(school, "id") === "string" &&
    typeof Reflect.get(school, "name") === "string" &&
    typeof Reflect.get(school, "slug") === "string"
  );
}
