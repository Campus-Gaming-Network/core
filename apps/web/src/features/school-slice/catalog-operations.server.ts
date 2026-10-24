import { ApiError, type ApiClient } from "../../server/api.server.js";
import { apiErrorReporter } from "../../server/api-error-reporter.server.js";
import { schoolLogoBase } from "../../server/environment.server.js";
import { optionalViewerProfile } from "../../server/viewer.server.js";
import { bundledSchoolLogo } from "./school-logos.server.js";
import {
  followedSchoolsResponseDtoSchema,
  schoolDtoSchema,
  schoolsPageSize,
  schoolsResponseDtoSchema,
  schoolStatsResponseDtoSchema,
  type HomeCatalogResult,
  type SchoolCatalogResult,
  type SchoolDTO,
  type SchoolSlugInput,
  type SchoolsBrowseInput,
  type SchoolsCatalogResult,
  type SchoolStatsDTO,
  type SchoolViewerInput,
  type SchoolViewerState,
} from "./contracts.js";

// How many schools the home page advertises.
const homeSchoolsLimit = 6;

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
  const schools = await readHomeSchools(api, reportError);
  return {
    schools: schools.data.map((school) => withVerifiedLogo(school, logoBase)),
    schoolsPopular: schools.popular,
    schoolsUnavailable: schools.unavailable,
  };
}

// The home page advertises the most popular schools. Until any school has
// members or public events there is no ranking, and if the ranking cannot be
// read the page still has schools to show, so either case falls back to the
// alphabetical list and says it is not a ranking.
async function readHomeSchools(
  api: ApiClient,
  reportError: (error: unknown) => void,
): Promise<{ data: SchoolDTO[]; popular: boolean; unavailable: boolean }> {
  try {
    const ranked = await readSchools(api, {
      sort: "popular",
      limit: homeSchoolsLimit,
    });
    if (ranked.schools.length > 0) {
      return { data: ranked.schools, popular: true, unavailable: false };
    }
  } catch (error) {
    reportError(error);
  }

  try {
    const listed = await readSchools(api, { limit: homeSchoolsLimit });
    return { data: listed.schools, popular: false, unavailable: false };
  } catch (error) {
    reportError(error);
    return { data: [], popular: false, unavailable: true };
  }
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
      stats: await readSchoolStats(
        api,
        page.schools.map((school) => school.slug),
        reportError,
      ),
      unavailable: false,
    };
  } catch (error) {
    reportError(error);
    return {
      schools: [],
      limit: schoolsPageSize,
      offset,
      has_more: false,
      stats: {},
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

/** One school's counts for its page, or null when they cannot be read. */
export async function schoolStatsOperation(
  { slug }: SchoolSlugInput,
  { api, reportError = defaultErrorReporter }: CatalogDependencies,
): Promise<SchoolStatsDTO | null> {
  return (await readSchoolStats(api, [slug], reportError))[slug] ?? null;
}

// Counts are extra detail: a failed read leaves rows without them rather than
// failing the page.
async function readSchoolStats(
  api: ApiClient,
  slugs: string[],
  reportError: (error: unknown) => void,
): Promise<Record<string, SchoolStatsDTO>> {
  if (slugs.length === 0) return {};
  const search = new URLSearchParams(slugs.map((slug) => ["school", slug]));
  try {
    const { data } = await api({
      path: `/school-stats?${search.toString()}`,
      cache: "no-store",
      responseSchema: schoolStatsResponseDtoSchema,
    });
    return Object.fromEntries(data.stats.map((stats) => [stats.slug, stats]));
  } catch (error) {
    reportError(error);
    return {};
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
    sort,
    limit,
    offset,
  }: {
    query?: string;
    state?: string;
    /** `popular` ranks by members and public events and takes only a limit. */
    sort?: "popular";
    limit?: number;
    offset?: number;
  },
) {
  const search = new URLSearchParams();
  if (query) search.set("q", query);
  if (state) search.set("state", state);
  if (sort) search.set("sort", sort);
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

// Approved admin uploads take precedence. Otherwise use an identifier-matched
// bundled logo; an arbitrary upstream URL never becomes an image request.
function withVerifiedLogo(
  school: SchoolDTO,
  logoBase: string | undefined,
): SchoolDTO {
  const { logo_url: logoURL, ...rest } = school;
  const fallback = { ...rest, ...bundledSchoolLogo(school) };
  if (!logoURL || !logoBase || !logoURL.startsWith(`${logoBase}/`)) {
    return fallback;
  }
  try {
    const parsed = new URL(logoURL);
    const valid =
      parsed.origin === new URL(logoBase).origin &&
      !parsed.username &&
      !parsed.password &&
      !parsed.search &&
      !parsed.hash;
    return valid ? school : fallback;
  } catch {
    return fallback;
  }
}

export const defaultErrorReporter = apiErrorReporter("School catalog");
