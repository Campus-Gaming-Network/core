import {
  ApiContractError,
  ApiError,
  type ApiClient,
} from "../../server/api.server.js";
import { loadGameFilterChoices } from "../game-picker/game-filter.server.js";
import { loadSchoolFilterChoices } from "../school-slice/school-filter.server.js";
import { withBundledSchoolLogo } from "../school-slice/school-logos.server.js";
import {
  clubDtoSchema,
  clubsPageSize,
  clubsResponseDtoSchema,
  schoolClubsResponseDtoSchema,
  type ClubDetailResult,
  type ClubsBrowsePageInput,
  type ClubsBrowsePageResult,
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

/**
 * One page of the clubs directory with its school and game filter choices. A
 * failed list never fails the page: it reports itself as unavailable.
 */
export async function clubsBrowsePageOperation(
  { schoolQuery, gameQuery, ...input }: ClubsBrowsePageInput,
  { api, reportError = defaultErrorReporter }: PublicDependencies,
): Promise<ClubsBrowsePageResult> {
  const search = new URLSearchParams();
  if (input.q) search.set("q", input.q);
  if (input.school) search.set("school", input.school);
  if (input.type) search.set("type", input.type);
  if (input.game) search.set("game", input.game);
  search.set("limit", String(clubsPageSize));
  if (input.after) search.set("after", input.after);
  else if (input.before) search.set("before", input.before);

  const [list, schoolFilter, gameFilter] = await Promise.all([
    api({
      path: `/clubs?${search.toString()}`,
      cache: "no-store",
      responseSchema: clubsResponseDtoSchema,
    }).then(
      ({ data }) => ({
        clubs: data.clubs.map((club) => ({
          ...club,
          school: withBundledSchoolLogo(club.school),
        })),
        has_more: data.has_more,
        has_previous: data.has_previous,
        ...(data.next_cursor ? { next_cursor: data.next_cursor } : {}),
        ...(data.previous_cursor
          ? { previous_cursor: data.previous_cursor }
          : {}),
        clubsUnavailable: false,
      }),
      (error: unknown) => {
        reportError(error);
        return {
          clubs: [],
          has_more: false,
          has_previous: false,
          clubsUnavailable: true,
        };
      },
    ),
    loadSchoolFilterChoices(
      api,
      { school: input.school, schoolQuery },
      reportError,
    ),
    loadGameFilterChoices(api, { game: input.game, gameQuery }, reportError),
  ]);
  return { ...list, ...schoolFilter, ...gameFilter };
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
