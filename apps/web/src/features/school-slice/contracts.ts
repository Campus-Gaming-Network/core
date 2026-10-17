import * as z from "zod";
import { pageNoticeKey } from "../../components/page-notice.js";
import {
  schoolBrowseNotices,
  schoolDetailNotices,
  type SchoolBrowseNotice,
  type SchoolDetailNotice,
} from "./presentation.js";

const identifierSchema = z.string().trim().min(1).max(200);
const nonNegativeIntegerSchema = z.number().int().nonnegative();

export const catalogClientStaleTime = 5 * 60 * 1000;
export const schoolsPageSize = 25;

export const schoolDtoSchema = z.object({
  id: identifierSchema,
  unitid: z.number().int().optional(),
  name: z.string(),
  alias: z.string().optional(),
  short_name: z.string().optional(),
  slug: identifierSchema,
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
  website_url: z.string().optional(),
  latitude: z.number().finite().optional(),
  longitude: z.number().finite().optional(),
  is_main_campus: z.boolean(),
  num_branches: nonNegativeIntegerSchema,
  logo_url: z.string().optional(),
});

export const schoolsResponseDtoSchema = z.object({
  schools: z.array(schoolDtoSchema),
  limit: nonNegativeIntegerSchema,
  offset: nonNegativeIntegerSchema,
  has_more: z.boolean(),
});

/** A school as a directory's school filter shows it: name, place, logo. */
export const schoolFilterOptionSchema = z.object({
  id: identifierSchema,
  name: z.string(),
  slug: identifierSchema,
  city: z.string().optional(),
  state: z.string().optional(),
  logo_url: z.string().optional(),
});

export const schoolFilterOptionsResponseSchema = z.object({
  schools: z.array(schoolFilterOptionSchema),
});

export const schoolFilterInputSchema = z.object({
  school: identifierSchema.optional(),
  schoolQuery: z.string().trim().max(120).optional(),
});

export type SchoolFilterOption = z.output<typeof schoolFilterOptionSchema>;

/** What a directory needs for its school filter. */
export type SchoolFilterChoices = {
  /** The school named by the `school` filter; absent when it cannot be found. */
  selectedSchool?: SchoolFilterOption;
  /** Matches for the no-JavaScript `school_q` search. */
  schools: SchoolFilterOption[];
  schoolSearchFailed: boolean;
};

export const followedSchoolsResponseDtoSchema = z.object({
  schools: z.array(schoolDtoSchema),
});

const gameDtoSchema = z.object({
  id: identifierSchema,
  name: z.string(),
  slug: identifierSchema,
  cover_url: z.string().optional(),
});

export const gamesResponseDtoSchema = z.object({
  games: z.array(gameDtoSchema),
});

export const schoolsBrowseInputSchema = z.object({
  query: z.string(),
  state: z.string(),
  page: z.number().int().positive(),
});

export const schoolSlugInputSchema = z.object({ slug: identifierSchema });
export const schoolViewerInputSchema = z.object({ schoolId: identifierSchema });
export const schoolFollowInputSchema = z
  .object({
    school_id: identifierSchema,
    slug: identifierSchema,
  })
  .strict();
export const emptyResponseDtoSchema = z.undefined();

const countSchema = z.number().int().nonnegative();

/** A school's CGN activity, as `/school-stats` counts it: not enrollment. */
export const schoolStatsDtoSchema = z.object({
  slug: identifierSchema,
  members: countSchema,
  teams: countSchema,
  upcoming_events: countSchema,
});
export const schoolStatsResponseDtoSchema = z.object({
  stats: z.array(schoolStatsDtoSchema),
});
export type SchoolStatsDTO = z.output<typeof schoolStatsDtoSchema>;

export type SchoolDTO = z.output<typeof schoolDtoSchema> & {
  /** Added by the BFF: a bundled logo the school page gives a wider mark. */
  logo_wide?: true;
  /** Added by the BFF: a bundled logo too wide to read in a small square. */
  logo_wordmark?: true;
  /** Added by the BFF for bundled logos; never accepted from the upstream API. */
  logo_attribution?: {
    author: string;
    credit: string;
    license: string;
    license_url: string;
    source_url: string;
  };
};
/** A school summary once the BFF has added its bundled logo, if it has one. */
export type WithSchoolLogo<T> = T & { logo_url?: string };
type SchoolsResponseDTO = Omit<
  z.output<typeof schoolsResponseDtoSchema>,
  "schools"
> & { schools: SchoolDTO[] };
export type SchoolsBrowseInput = z.output<typeof schoolsBrowseInputSchema>;
export type SchoolSlugInput = z.output<typeof schoolSlugInputSchema>;
export type SchoolViewerInput = z.output<typeof schoolViewerInputSchema>;
export type SchoolFollowInput = z.output<typeof schoolFollowInputSchema>;

export type HomeCatalogResult = {
  schools: SchoolDTO[];
  /** True when `schools` is a ranking by popularity, not an alphabetical list. */
  schoolsPopular: boolean;
  schoolsUnavailable: boolean;
};

export type SchoolsCatalogResult = SchoolsResponseDTO & {
  /** Each listed school's counts by slug; empty when they could not be read. */
  stats: Record<string, SchoolStatsDTO>;
  unavailable: boolean;
};

export type SchoolCatalogResult =
  | { status: "found"; school: SchoolDTO }
  | { status: "not_found" }
  | { status: "error"; message: "School details are unavailable." };

export type SchoolViewerState =
  | { authenticated: false; isHomeSchool: false; isFollowing: false }
  | { authenticated: true; isHomeSchool: boolean; isFollowing: boolean };

export type SchoolFollowRedirectResult = {
  status: "success";
  redirectTo: string;
};

type ValidatedSchoolFollowInput =
  | { valid: true; value: SchoolFollowInput }
  | { valid: false; slug?: string };

export type SchoolsSearch = {
  q?: string;
  state?: string;
  page?: number;
  follow?: SchoolBrowseNotice;
};

export function validateSchoolsSearch(
  search: Record<string, unknown>,
): SchoolsSearch {
  const q = firstString(search.q).trim();
  const state = firstString(search.state).trim();
  const page = pageNumber(firstString(search.page));
  const follow = pageNoticeKey(schoolBrowseNotices, search.follow);

  return {
    ...(q ? { q } : {}),
    ...(state ? { state } : {}),
    ...(page > 1 ? { page } : {}),
    ...(follow ? { follow } : {}),
  };
}

type SchoolTab = "events" | "teams";

type SchoolSearch = { follow?: SchoolDetailNotice; tab?: SchoolTab };

export function validateSchoolSearch(
  search: Record<string, unknown>,
): SchoolSearch {
  const follow = pageNoticeKey(schoolDetailNotices, search.follow);
  const tab =
    search.tab === "events" || search.tab === "teams" ? search.tab : undefined;
  return { ...(follow ? { follow } : {}), ...(tab ? { tab } : {}) };
}

export function schoolsBrowseInput(search: SchoolsSearch): SchoolsBrowseInput {
  return {
    query: search.q ?? "",
    state: search.state ?? "",
    page: search.page ?? 1,
  };
}

export function validateSchoolFollowServerInput(
  input: SchoolFollowInput | FormData,
): ValidatedSchoolFollowInput {
  const candidate = {
    school_id: inputValue(input, "school_id"),
    slug: inputValue(input, "slug"),
  };
  const parsed = schoolFollowInputSchema.safeParse(
    input instanceof FormData ? candidate : input,
  );
  if (parsed.success) return { valid: true, value: parsed.data };
  return {
    valid: false,
    ...(identifierSchema.safeParse(candidate.slug).success
      ? { slug: candidate.slug.trim() }
      : {}),
  };
}

function pageNumber(value: string): number {
  if (!/^\d+$/.test(value)) {
    return 1;
  }
  const page = Number(value);
  const offset = (page - 1) * schoolsPageSize;
  return Number.isSafeInteger(page) && page > 0 && Number.isSafeInteger(offset)
    ? page
    : 1;
}

function firstString(value: unknown): string {
  if (Array.isArray(value)) {
    return typeof value[0] === "string" ? value[0] : "";
  }
  return typeof value === "string" ? value : "";
}

function inputValue(input: object | FormData, field: string): string {
  const value =
    input instanceof FormData ? input.get(field) : Reflect.get(input, field);
  return typeof value === "string" ? value : "";
}
