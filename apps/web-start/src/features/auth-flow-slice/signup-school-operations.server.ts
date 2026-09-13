import type { ApiClient } from "../../server/api.server.js";
import { readSchools } from "../school-slice/catalog-operations.server.js";
import type { SchoolDTO } from "../school-slice/contracts.js";

export type SignupSchoolSearchResult = {
  schools: SchoolDTO[];
  failed: boolean;
};

export async function signupSchoolSearchOperation(
  query: string,
  {
    api,
    reportError = () => undefined
  }: { api: ApiClient; reportError?: (error: unknown) => void }
): Promise<SignupSchoolSearchResult> {
  if (query.trim().length < 2) {
    return { schools: [], failed: false };
  }

  try {
    const result = await readSchools(api, { query, limit: 50 });
    return { schools: result.schools, failed: false };
  } catch (error) {
    reportError(error);
    return { schools: [], failed: true };
  }
}
