import {
  ApiContractError,
  ApiError,
  type ApiClient,
} from "../../server/api.server.js";
import { schoolLogoBase } from "../../server/environment.server.js";
import { optionalViewerProfile } from "../../server/viewer.server.js";
import {
  followedSchoolsResponseDtoSchema,
  gamesResponseDtoSchema,
  schoolDtoSchema,
  schoolsPageSize,
  schoolsResponseDtoSchema,
  type HomeCatalogResult,
  type SchoolCatalogResult,
  type SchoolDTO,
  type SchoolSlugInput,
  type SchoolsBrowseInput,
  type SchoolsCatalogResult,
  type SchoolViewerInput,
  type SchoolViewerState,
} from "./contracts.js";

type CatalogDependencies = {
  api: ApiClient;
  /** Where school logos are served from; defaults to the configured base. */
  logoBase?: string;
  reportError?: (error: unknown) => void;
};

type ViewerDependencies = CatalogDependencies & {
  cookieHeader: string;
  sessionCookieValue?: string;
};

export async function homeCatalogOperation({
  api,
  logoBase = schoolLogoBase(),
  reportError = defaultErrorReporter,
}: CatalogDependencies): Promise<HomeCatalogResult> {
  const [schools, games] = await Promise.all([
    readSchools(api, { limit: 6 })
      .then((result) => ({
        data: result.schools.map((school) =>
          withVerifiedLogo(school, logoBase),
        ),
        unavailable: false,
      }))
      .catch((error: unknown) => {
        reportError(error);
        return { data: [], unavailable: true };
      }),
    api({
      path: "/games",
      cache: "no-store",
      responseSchema: gamesResponseDtoSchema,
    })
      .then(({ data }) => ({ data: data.games, unavailable: false }))
      .catch((error: unknown) => {
        reportError(error);
        return { data: [], unavailable: true };
      }),
  ]);

  return {
    schools: schools.data,
    games: games.data,
    schoolsUnavailable: schools.unavailable,
    gamesUnavailable: games.unavailable,
  };
}

export async function schoolsCatalogOperation(
  input: SchoolsBrowseInput,
  {
    api,
    logoBase = schoolLogoBase(),
    reportError = defaultErrorReporter,
  }: CatalogDependencies,
): Promise<SchoolsCatalogResult> {
  const offset = (input.page - 1) * schoolsPageSize;

  try {
    const page = await readSchools(api, {
      query: input.query,
      state: input.state,
      limit: schoolsPageSize,
      offset,
    });
    return {
      ...page,
      schools: page.schools.map((school) => withVerifiedLogo(school, logoBase)),
      unavailable: false,
    };
  } catch (error) {
    reportError(error);
    return {
      schools: [],
      limit: schoolsPageSize,
      offset,
      has_more: false,
      unavailable: true,
    };
  }
}

export async function schoolCatalogOperation(
  { slug }: SchoolSlugInput,
  {
    api,
    logoBase = schoolLogoBase(),
    reportError = defaultErrorReporter,
  }: CatalogDependencies,
): Promise<SchoolCatalogResult> {
  try {
    const { data } = await api({
      path: `/schools/${encodeURIComponent(slug)}`,
      cache: "no-store",
      responseSchema: schoolDtoSchema,
    });
    return { status: "found", school: withVerifiedLogo(data, logoBase) };
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
    reportError = defaultErrorReporter,
  }: ViewerDependencies,
): Promise<SchoolViewerState> {
  try {
    const profile = await optionalViewerProfile({
      api,
      cookieHeader,
      sessionCookieValue,
    });
    if (!profile) {
      return {
        authenticated: false,
        isHomeSchool: false,
        isFollowing: false,
      };
    }

    const { data } = await api({
      path: "/me/schools",
      cookieHeader,
      cache: "no-store",
      responseSchema: followedSchoolsResponseDtoSchema,
    });
    const isHomeSchool = profile.home_school_id === schoolId;

    return {
      authenticated: true,
      isHomeSchool,
      isFollowing: data.schools.some((school) => school.id === schoolId),
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
    offset,
  }: {
    query?: string;
    state?: string;
    limit?: number;
    offset?: number;
  },
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
    responseSchema: schoolsResponseDtoSchema,
  });
  return data;
}

// The API stores absolute logo URLs. The page renders one only when it points
// into the configured asset location, so a stray or tampered value never
// becomes an image request to another host.
function withVerifiedLogo(
  school: SchoolDTO,
  logoBase: string | undefined,
): SchoolDTO {
  const { logo_url: logoURL, ...rest } = school;
  if (!logoURL || !logoBase || !logoURL.startsWith(`${logoBase}/`)) {
    return rest;
  }
  try {
    const parsed = new URL(logoURL);
    const valid =
      parsed.origin === new URL(logoBase).origin &&
      !parsed.username &&
      !parsed.password &&
      !parsed.search &&
      !parsed.hash;
    return valid ? school : rest;
  } catch {
    return rest;
  }
}

function defaultErrorReporter(error: unknown): void {
  if (error instanceof ApiContractError) {
    console.error("School catalog response contract violation", {
      path: error.path,
      issues: error.issues,
    });
  } else if (!(error instanceof ApiError)) {
    console.error("School catalog request failed");
  }
}
