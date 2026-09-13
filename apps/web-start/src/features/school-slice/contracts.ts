import * as z from "zod";

const identifierSchema = z.string().trim().min(1).max(200);
const nonNegativeIntegerSchema = z.number().int().nonnegative();

export const catalogClientStaleTime = 5 * 60 * 1000;
export const schoolsPageSize = 25;

export const schoolDtoSchema = z.object({
  id: identifierSchema,
  unitid: z.number().int().optional(),
  name: z.string(),
  alias: z.string().optional(),
  slug: identifierSchema,
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
  website_url: z.string().optional(),
  latitude: z.number().finite().optional(),
  longitude: z.number().finite().optional(),
  is_main_campus: z.boolean(),
  num_branches: nonNegativeIntegerSchema
});

export const schoolsResponseDtoSchema = z.object({
  schools: z.array(schoolDtoSchema),
  limit: nonNegativeIntegerSchema,
  offset: nonNegativeIntegerSchema,
  has_more: z.boolean()
});

export const followedSchoolsResponseDtoSchema = z.object({
  schools: z.array(schoolDtoSchema)
});

export const gameDtoSchema = z.object({
  id: identifierSchema,
  name: z.string(),
  slug: identifierSchema,
  cover_url: z.string().optional()
});

export const gamesResponseDtoSchema = z.object({
  games: z.array(gameDtoSchema)
});

export const schoolsBrowseInputSchema = z.object({
  query: z.string(),
  state: z.string(),
  page: z.number().int().positive()
});

export const schoolSlugInputSchema = z.object({ slug: identifierSchema });
export const schoolViewerInputSchema = z.object({ schoolId: identifierSchema });
export const schoolFollowInputSchema = z
  .object({
    school_id: identifierSchema,
    slug: identifierSchema
  })
  .strict();
export const emptyResponseDtoSchema = z.undefined();

export type SchoolDTO = z.output<typeof schoolDtoSchema>;
export type SchoolsResponseDTO = z.output<typeof schoolsResponseDtoSchema>;
export type GameDTO = z.output<typeof gameDtoSchema>;
export type SchoolsBrowseInput = z.output<typeof schoolsBrowseInputSchema>;
export type SchoolSlugInput = z.output<typeof schoolSlugInputSchema>;
export type SchoolViewerInput = z.output<typeof schoolViewerInputSchema>;
export type SchoolFollowInput = z.output<typeof schoolFollowInputSchema>;

export type HomeCatalogResult = {
  schools: SchoolDTO[];
  games: GameDTO[];
  schoolsUnavailable: boolean;
  gamesUnavailable: boolean;
};

export type SchoolsCatalogResult = SchoolsResponseDTO & {
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

export type ValidatedSchoolFollowInput =
  | { valid: true; value: SchoolFollowInput }
  | { valid: false; slug?: string };

export type SchoolsSearch = {
  q?: string;
  state?: string;
  page?: number;
  follow?: "added" | "failed" | "removed";
};

export function validateSchoolsSearch(
  search: Record<string, unknown>
): SchoolsSearch {
  const q = firstString(search.q).trim();
  const state = firstString(search.state).trim();
  const page = pageNumber(firstString(search.page));
  const follow = firstString(search.follow);

  return {
    ...(q ? { q } : {}),
    ...(state ? { state } : {}),
    ...(page > 1 ? { page } : {}),
    ...(follow === "added" || follow === "failed" || follow === "removed"
      ? { follow }
      : {})
  };
}

export function schoolsBrowseInput(search: SchoolsSearch): SchoolsBrowseInput {
  return {
    query: search.q ?? "",
    state: search.state ?? "",
    page: search.page ?? 1
  };
}

export function validateSchoolFollowServerInput(
  input: SchoolFollowInput | FormData
): ValidatedSchoolFollowInput {
  const candidate = {
    school_id: inputValue(input, "school_id"),
    slug: inputValue(input, "slug")
  };
  const parsed = schoolFollowInputSchema.safeParse(
    input instanceof FormData ? candidate : input
  );
  if (parsed.success) return { valid: true, value: parsed.data };
  return {
    valid: false,
    ...(identifierSchema.safeParse(candidate.slug).success
      ? { slug: candidate.slug.trim() }
      : {})
  };
}

export function pageNumber(value: string): number {
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
  const value = input instanceof FormData
    ? input.get(field)
    : Reflect.get(input, field);
  return typeof value === "string" ? value : "";
}
