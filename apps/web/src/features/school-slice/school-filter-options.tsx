import type { SearchFilterOption } from "../../components/search-filter";
import { SchoolMark } from "../../components/school-mark";
import { schoolsResponseDtoSchema, type SchoolFilterOption } from "./contracts";
import { schoolLocation } from "./presentation";

/** A school as the directories' school filter lists it: logo, name, place. */
export function schoolFilterOption(
  school: SchoolFilterOption,
): SearchFilterOption {
  return {
    value: school.slug,
    label: school.name,
    detail: schoolLocation(school, "") || undefined,
    mark: (
      <SchoolMark
        className="search-filter__mark"
        logoURL={school.logo_url}
        name={school.name}
        size={32}
        slug={school.slug}
      />
    ),
  };
}

/** Searches schools by name through the site, for the school filter. */
export async function searchSchoolFilter(
  query: string,
  signal: AbortSignal,
): Promise<SearchFilterOption[]> {
  const search = new URLSearchParams({ q: query, limit: "20" });
  const response = await fetch(`/api/schools?${search.toString()}`, { signal });
  if (!response.ok) throw new Error("school search failed");
  const parsed = schoolsResponseDtoSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error("invalid school search response");
  return parsed.data.schools.map(schoolFilterOption);
}
