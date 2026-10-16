import { ApiError, type ApiClient } from "../../server/api.server.js";
import {
  schoolFilterOptionSchema,
  schoolFilterOptionsResponseSchema,
  type SchoolFilterChoices,
} from "./contracts.js";
import { withBundledSchoolLogo } from "./school-logos.server.js";

/**
 * Loads a directory's school filter: the school its `school` slug names, so
 * the filter shows a name and logo instead of a slug, and the matches for a
 * no-JavaScript `school_q` search. A school that no longer exists is left
 * unnamed without a report; other failures are reported and leave the
 * directory itself working.
 */
export async function loadSchoolFilterChoices(
  api: ApiClient,
  { school, schoolQuery }: { school?: string; schoolQuery?: string },
  reportError: (error: unknown) => void,
): Promise<SchoolFilterChoices> {
  const [selectedSchool, search] = await Promise.all([
    school
      ? api({
          path: `/schools/${encodeURIComponent(school)}`,
          cache: "no-store",
          responseSchema: schoolFilterOptionSchema,
        })
          .then(({ data }) => withBundledSchoolLogo(data))
          .catch((error: unknown) => {
            if (!(error instanceof ApiError && error.status === 404)) {
              reportError(error);
            }
            return undefined;
          })
      : Promise.resolve(undefined),
    schoolQuery && schoolQuery.length >= 2
      ? api({
          path: `/schools?${new URLSearchParams({ q: schoolQuery, limit: "50" }).toString()}`,
          cache: "no-store",
          responseSchema: schoolFilterOptionsResponseSchema,
        })
          .then(({ data }) => ({
            schools: data.schools.map(withBundledSchoolLogo),
            failed: false,
          }))
          .catch((error: unknown) => {
            reportError(error);
            return { schools: [], failed: true };
          })
      : Promise.resolve({ schools: [], failed: false }),
  ]);

  return {
    ...(selectedSchool ? { selectedSchool } : {}),
    schools: search.schools,
    schoolSearchFailed: search.failed,
  };
}
