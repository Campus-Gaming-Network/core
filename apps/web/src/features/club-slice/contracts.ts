import * as z from "zod";
import type { GameFilterChoices } from "../game-picker/contracts.js";
import type {
  SchoolFilterChoices,
  WithSchoolLogo,
} from "../school-slice/contracts.js";

const identifierSchema = z.string().trim().min(1).max(200);

export const clubTypeSchema = z.enum(["student_club", "university_program"]);

const clubGameSchema = z.object({
  id: identifierSchema,
  name: z.string(),
  slug: identifierSchema,
  has_cover: z.boolean(),
});

// Only http(s) links reach a page; the API enforces the same rule on write.
const clubLinkSchema = z.object({
  type: z.enum(["website", "discord", "social"]),
  label: z.string(),
  url: z
    .string()
    .refine((value) => /^https?:\/\//i.test(value), "Unsafe link."),
});

/** One published club as its page shows it. */
export const clubDtoSchema = z.object({
  id: identifierSchema,
  name: z.string(),
  slug: identifierSchema,
  type: clubTypeSchema,
  summary: z.string(),
  how_to_join: z.string().optional(),
  school: z.object({
    id: identifierSchema,
    name: z.string(),
    slug: identifierSchema,
    city: z.string().optional(),
    state: z.string().optional(),
  }),
  games: z.array(clubGameSchema),
  links: z.array(clubLinkSchema),
  claimed: z.boolean(),
  confirmed_at: z.iso.datetime({ offset: true }).optional(),
  confirmed_source: z.enum(["club", "cgn"]).optional(),
});

/** A school's clubs as the school page lists them. */
export const schoolClubsResponseDtoSchema = z.object({
  clubs: z.array(
    z.object({
      id: identifierSchema,
      name: z.string(),
      slug: identifierSchema,
      type: clubTypeSchema,
      summary: z.string(),
      games: z.array(clubGameSchema),
      claimed: z.boolean(),
    }),
  ),
});

/** One page of the clubs directory, across schools, by name. */
export const clubsResponseDtoSchema = z.object({
  clubs: z.array(
    z.object({
      id: identifierSchema,
      name: z.string(),
      slug: identifierSchema,
      type: clubTypeSchema,
      summary: z.string(),
      games: z.array(clubGameSchema),
      claimed: z.boolean(),
      school: z.object({
        id: identifierSchema,
        name: z.string(),
        slug: identifierSchema,
        city: z.string().optional(),
        state: z.string().optional(),
      }),
    }),
  ),
  limit: z.number().int().nonnegative(),
  has_more: z.boolean(),
  has_previous: z.boolean(),
  next_cursor: z.string().min(1).optional(),
  previous_cursor: z.string().min(1).optional(),
});

export const clubsPageSize = 25;

const filterSchema = z.string().trim().max(200);
const cursorSchema = z.string().trim().max(2048);

/** What the clubs directory asks the API for, plus its filter searches. */
export const clubsBrowsePageInputSchema = z.object({
  q: z.string().trim().max(100),
  school: filterSchema,
  type: z.union([clubTypeSchema, z.literal("")]),
  game: filterSchema,
  after: cursorSchema,
  before: cursorSchema,
  // The school search API rejects queries longer than this.
  schoolQuery: z.string().trim().max(120),
  gameQuery: z.string().trim().max(100),
});

export const clubSlugInputSchema = z.object({ slug: identifierSchema });

export type ClubType = z.output<typeof clubTypeSchema>;
export type ClubDTO = Omit<z.output<typeof clubDtoSchema>, "school"> & {
  school: WithSchoolLogo<z.output<typeof clubDtoSchema>["school"]>;
};
export type SchoolClubDTO = z.output<
  typeof schoolClubsResponseDtoSchema
>["clubs"][number];

export type ClubListItemDTO = z.output<
  typeof clubsResponseDtoSchema
>["clubs"][number];
export type ClubsBrowsePageInput = z.output<typeof clubsBrowsePageInputSchema>;

/** The clubs directory's query string. Defaults are left out. */
export type ClubsSearch = {
  /** Part of a club's name. */
  q?: string;
  /** Slug of the school whose clubs are listed. */
  school?: string;
  type?: ClubType;
  game?: string;
  /** Searches schools for the no-JavaScript school selector. */
  school_q?: string;
  /** Searches games for the no-JavaScript game filter. */
  game_q?: string;
  after?: string;
  before?: string;
};

export type ClubsBrowsePageResult = {
  clubs: (Omit<ClubListItemDTO, "school"> & {
    school: WithSchoolLogo<ClubListItemDTO["school"]>;
  })[];
  has_more: boolean;
  has_previous: boolean;
  next_cursor?: string;
  previous_cursor?: string;
  /** True when the list could not be read; the page says so. */
  clubsUnavailable: boolean;
} & SchoolFilterChoices &
  GameFilterChoices;

export type ClubDetailResult =
  | { status: "found"; club: ClubDTO }
  | { status: "not_found" }
  | { status: "error" };

export type SchoolClubsResult = {
  clubs: SchoolClubDTO[];
  /** True when the list could not be read; the school page says so. */
  unavailable: boolean;
};

/**
 * Reads the clubs directory's query string. A value that is too long, or a
 * type the directory does not know, is dropped rather than failing the page.
 */
export function validateClubsSearch(
  search: Record<string, unknown>,
): ClubsSearch {
  const q = tolerantSearchValue(search.q, 100);
  const school = tolerantSearchValue(search.school, 200);
  const type = clubTypeSchema.safeParse(tolerantSearchValue(search.type, 40));
  const game = tolerantSearchValue(search.game, 200);
  const schoolQuery = tolerantSearchValue(search.school_q, 120);
  const gameQuery = tolerantSearchValue(search.game_q, 100);
  const after = tolerantSearchValue(search.after, 2048);
  const before = tolerantSearchValue(search.before, 2048);
  return {
    ...(q ? { q } : {}),
    ...(school ? { school } : {}),
    ...(type.success ? { type: type.data } : {}),
    ...(game ? { game } : {}),
    ...(schoolQuery ? { school_q: schoolQuery } : {}),
    ...(gameQuery ? { game_q: gameQuery } : {}),
    // Only one direction pages at a time; forward wins.
    ...(after ? { after } : before ? { before } : {}),
  };
}

export function clubsBrowsePageInput(
  search: ClubsSearch,
): ClubsBrowsePageInput {
  return {
    q: search.q ?? "",
    school: search.school ?? "",
    type: search.type ?? "",
    game: search.game ?? "",
    after: search.after ?? "",
    before: search.before ?? "",
    schoolQuery: search.school_q ?? "",
    gameQuery: search.game_q ?? "",
  };
}

function tolerantSearchValue(value: unknown, maximumLength: number): string {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (typeof candidate !== "string") return "";
  const normalized = candidate.trim();
  return normalized.length <= maximumLength ? normalized : "";
}
