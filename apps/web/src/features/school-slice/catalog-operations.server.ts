import {
  ApiContractError,
  ApiError,
  type ApiClient
} from "../../server/api.server.js";
import { optionalViewerProfile } from "../../server/viewer.server.js";
import {
  followedSchoolsResponseDtoSchema,
  gamesResponseDtoSchema,
  schoolDtoSchema,
  schoolsPageSize,
  schoolsResponseDtoSchema,
  type HomeCatalogResult,
  type SchoolCatalogResult,
  type SchoolSlugInput,
  type SchoolsBrowseInput,
  type SchoolsCatalogResult,
  type SchoolViewerInput,
  type SchoolViewerState
} from "./contracts.js";

type CatalogDependencies = {
  api: ApiClient;
  reportError?: (error: unknown) => void;
};

type ViewerDependencies = CatalogDependencies & {
  cookieHeader: string;
  sessionCookieValue?: string;
};

export async function homeCatalogOperation({
  api,
  reportError = defaultErrorReporter
}: CatalogDependencies): Promise<HomeCatalogResult> {
  const [schools, games] = await Promise.all([
    readSchools(api, { limit: 6 })
      .then((result) => ({ data: result.schools, unavailable: false }))
      .catch((error: unknown) => {
        reportError(error);
        return { data: [], unavailable: true };
      }),
    api({
      path: "/games",
      cache: "no-store",
      responseSchema: gamesResponseDtoSchema
    })
      .then(({ data }) => ({ data: data.games, unavailable: false }))
      .catch((error: unknown) => {
        reportError(error);
        return { data: [], unavailable: true };
      })
  ]);

  return {
    schools: schools.data,
    games: games.data,
    schoolsUnavailable: schools.unavailable,
    gamesUnavailable: games.unavailable
  };
}

export async function schoolsCatalogOperation(
  input: SchoolsBrowseInput,
  { api, reportError = defaultErrorReporter }: CatalogDependencies
): Promise<SchoolsCatalogResult> {
  const offset = (input.page - 1) * schoolsPageSize;

  try {
    return {
      ...(await readSchools(api, {
        query: input.query,
        state: input.state,
        limit: schoolsPageSize,
        offset
      })),
      unavailable: false
    };
  } catch (error) {
    reportError(error);
    return {
      schools: [],
      limit: schoolsPageSize,
      offset,
      has_more: false,
      unavailable: true
    };
  }
}

export async function schoolCatalogOperation(
  { slug }: SchoolSlugInput,
  { api, reportError = defaultErrorReporter }: CatalogDependencies
): Promise<SchoolCatalogResult> {
  try {
    const { data } = await api({
      path: `/schools/${encodeURIComponent(slug)}`,
      cache: "no-store",
      responseSchema: schoolDtoSchema
    });
    return { status: "found", school: data };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return { status: "not_found" };
    }
    reportError(error);
    return { status: "error", message: "School details are unavailable." };
  }
}

export async function schoolViewerStateOperation(
  { schoolId }: SchoolViewerInput,
  {
    api,
    cookieHeader,
    sessionCookieValue,
    reportError = defaultErrorReporter
  }: ViewerDependencies
): Promise<SchoolViewerState> {
  try {
    const profile = await optionalViewerProfile({
      api,
      cookieHeader,
      sessionCookieValue
    });
    if (!profile) {
      return {
        authenticated: false,
        isHomeSchool: false,
        isFollowing: false
      };
    }

    const { data } = await api({
      path: "/me/schools",
      cookieHeader,
      cache: "no-store",
      responseSchema: followedSchoolsResponseDtoSchema
    });
    const isHomeSchool = profile.home_school_id === schoolId;

    return {
      authenticated: true,
      isHomeSchool,
      isFollowing: data.schools.some((school) => school.id === schoolId)
    };
  } catch (error) {
    reportError(error);
    throw error;
  }
}

export async function readSchools(
  api: ApiClient,
  {
    query,
    state,
    limit,
    offset
  }: {
    query?: string;
    state?: string;
    limit?: number;
    offset?: number;
  }
) {
  const search = new URLSearchParams();
  if (query) search.set("q", query);
  if (state) search.set("state", state);
  if (limit) search.set("limit", String(limit));
  if (offset) search.set("offset", String(offset));

  const suffix = search.size > 0 ? `?${search.toString()}` : "";
  const { data } = await api({
    path: `/schools${suffix}`,
    cache: "no-store",
    responseSchema: schoolsResponseDtoSchema
  });
  return data;
}

function defaultErrorReporter(error: unknown): void {
  if (error instanceof ApiContractError) {
    console.error("School catalog response contract violation", {
      path: error.path,
      issues: error.issues
    });
  } else if (!(error instanceof ApiError)) {
    console.error("School catalog request failed");
  }
}
