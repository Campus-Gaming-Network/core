import type { SchoolSummary } from "./api-contracts";

export type SchoolPickerOption = Pick<
  SchoolSummary,
  "id" | "name" | "city" | "state"
>;

export type SchoolSearchStatus = "idle" | "loading" | "success" | "error";

export function schoolPickerOptionLabel(school: SchoolPickerOption) {
  const location = [school.city, school.state].filter(Boolean).join(", ");

  return `${school.name}${location ? ` (${location})` : ""}`;
}

export function hydrateSchoolPickerSelection(
  selectedSchoolID: string | undefined,
  selectedSchool: SchoolPickerOption | undefined,
  initialSchools: SchoolPickerOption[]
): SchoolPickerOption | undefined {
  if (selectedSchool) {
    return selectedSchool;
  }

  if (!selectedSchoolID) {
    return undefined;
  }

  return (
    initialSchools.find((school) => school.id === selectedSchoolID) ?? {
      id: selectedSchoolID,
      name: "Selected school"
    }
  );
}

export function mergeSchoolPickerOptions(
  selectedSchool: SchoolPickerOption | undefined,
  schools: SchoolPickerOption[]
) {
  const options = selectedSchool ? [selectedSchool, ...schools] : schools;
  const seen = new Set<string>();

  return options.filter((school) => {
    if (seen.has(school.id)) {
      return false;
    }

    seen.add(school.id);
    return true;
  });
}

export function schoolSearchStatusMessage({
  query,
  resultCount,
  status
}: {
  query: string;
  resultCount: number;
  status: SchoolSearchStatus;
}) {
  if (status === "loading") {
    return "Searching schools…";
  }

  if (status === "error") {
    return "We couldn’t load schools. Check your connection and try again.";
  }

  const trimmedQuery = query.trim();
  if (trimmedQuery.length < 2) {
    return "Type at least 2 characters to search every active school.";
  }

  if (resultCount === 0) {
    return `No schools found for “${trimmedQuery}”.`;
  }

  return `${resultCount} ${resultCount === 1 ? "school" : "schools"} found.`;
}

export function isSchoolSearchResponse(
  value: unknown
): value is { schools: SchoolPickerOption[] } {
  if (typeof value !== "object" || value === null || !("schools" in value)) {
    return false;
  }

  const { schools } = value as { schools?: unknown };

  return (
    Array.isArray(schools) &&
    schools.every(
      (school) =>
        typeof school === "object" &&
        school !== null &&
        "id" in school &&
        typeof school.id === "string" &&
        "name" in school &&
        typeof school.name === "string" &&
        (!("city" in school) || typeof school.city === "string") &&
        (!("state" in school) || typeof school.state === "string")
    )
  );
}
