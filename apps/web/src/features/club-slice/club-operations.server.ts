import {
  ApiContractError,
  ApiError,
  type ApiClient,
} from "../../server/api.server.js";
import { withBundledSchoolLogo } from "../school-slice/school-logos.server.js";
import {
  clubDtoSchema,
  schoolClubsResponseDtoSchema,
  type ClubDetailResult,
  type SchoolClubsResult,
} from "./contracts.js";

type PublicDependencies = {
  api: ApiClient;
  reportError?: (error: unknown) => void;
};

/** One published club; a hidden or missing club is not found. */
export async function clubDetailOperation(
  { slug }: { slug: string },
  { api, reportError = defaultErrorReporter }: PublicDependencies,
): Promise<ClubDetailResult> {
  try {
    const { data } = await api({
      path: `/clubs/${encodeURIComponent(slug)}`,
      cache: "no-store",
      responseSchema: clubDtoSchema,
    });
    return {
      status: "found",
      club: { ...data, school: withBundledSchoolLogo(data.school) },
    };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return { status: "not_found" };
    }
    reportError(error);
    return { status: "error" };
  }
}

/**
 * A school's published clubs. A failure never fails the school page: it
 * reports itself as unavailable so the page can say so.
 */
export async function schoolClubsOperation(
  { slug }: { slug: string },
  { api, reportError = defaultErrorReporter }: PublicDependencies,
): Promise<SchoolClubsResult> {
  try {
    const { data } = await api({
      path: `/schools/${encodeURIComponent(slug)}/clubs`,
      cache: "no-store",
      responseSchema: schoolClubsResponseDtoSchema,
    });
    return { clubs: data.clubs, unavailable: false };
  } catch (error) {
    reportError(error);
    return { clubs: [], unavailable: true };
  }
}

// Logs what failed without the response body, like the other slices.
function defaultErrorReporter(error: unknown): void {
  if (error instanceof ApiContractError) {
    console.error("Club response contract violation", {
      path: error.path,
      issues: error.issues,
    });
  } else if (!(error instanceof ApiError)) {
    console.error("Club request failed");
  }
}
