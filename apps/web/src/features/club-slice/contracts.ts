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

function requiredText(label: string, maximum: number) {
  return z
    .string()
    .trim()
    .min(1, `${label} is required.`)
    .max(maximum, `${label} must be ${maximum} characters or fewer.`);
}

/** How an applicant shows they run the club; the API checks the same rules. */
const claimEvidenceSchema = z.object({
  evidence_text: requiredText("Evidence", 2000),
  evidence_url: z
    .string()
    .trim()
    .max(500, "The link must be 500 characters or fewer.")
    .refine(
      (value) => value === "" || /^https?:\/\/[^\s/]+/i.test(value),
      "Enter a link that starts with http:// or https://.",
    ),
});

export const clubClaimInputSchema = claimEvidenceSchema.extend({
  slug: identifierSchema,
});

export const clubRequestInputSchema = claimEvidenceSchema.extend({
  school_slug: identifierSchema,
  name: requiredText("Club name", 120),
  type: z.enum(clubTypeSchema.options, "Choose a club type."),
});

export const claimReceiptDtoSchema = z.object({ status: z.literal("pending") });

export type ClubClaimInput = z.output<typeof clubClaimInputSchema>;
export type ClubRequestInput = z.output<typeof clubRequestInputSchema>;
export type ClaimFieldErrors = Record<string, string[] | undefined>;

/**
 * How a claim or request ended. A native form post returns to its page with
 * this in the query string; an enhanced one shows the failures in place.
 */
export const claimOutcomes = [
  "submitted",
  "failed",
  "pending",
  "claimed",
  "listed",
] as const;
export type ClaimOutcome = (typeof claimOutcomes)[number];

/** What each failed outcome tells the applicant. */
export const claimFailureMessages: Record<
  Exclude<ClaimOutcome, "submitted">,
  string
> = {
  failed: "We could not send that. Please try again.",
  pending:
    "You already asked about this club. A site admin will review it and email you.",
  claimed:
    "This club is already managed by its officers. If you run it and cannot reach them, contact support.",
  listed:
    "A club with that name is already listed at this school. Open its page and claim it instead.",
};

export type ClaimSubmitResult =
  | { status: "success"; redirectTo: string }
  | {
      status: "error";
      outcome: Exclude<ClaimOutcome, "submitted">;
      message: string;
      fieldErrors?: ClaimFieldErrors;
    };

export type Validated<T> =
  | { valid: true; value: T }
  | {
      valid: false;
      /** Where a native post returns: the form's page, when it is known. */
      page: string;
      message: "Check the highlighted fields and try again.";
      fieldErrors: ClaimFieldErrors;
    };

export function validateClubClaimServerInput(
  input: FormData | object,
): Validated<ClubClaimInput> {
  const slug = inputValue(input, "slug");
  return validated(
    clubClaimInputSchema.safeParse({
      slug,
      evidence_text: inputValue(input, "evidence_text"),
      evidence_url: inputValue(input, "evidence_url"),
    }),
    clubClaimPage(slug),
  );
}

export function validateClubRequestServerInput(
  input: FormData | object,
): Validated<ClubRequestInput> {
  const schoolSlug = inputValue(input, "school_slug");
  return validated(
    clubRequestInputSchema.safeParse({
      school_slug: schoolSlug,
      name: inputValue(input, "name"),
      type: inputValue(input, "type"),
      evidence_text: inputValue(input, "evidence_text"),
      evidence_url: inputValue(input, "evidence_url"),
    }),
    clubRequestPage(schoolSlug),
  );
}

/** The claim form's page; an unusable slug falls back to the directory. */
export function clubClaimPage(slug: string): string {
  return identifierSchema.safeParse(slug).success
    ? `/clubs/${encodeURIComponent(slug)}/claim`
    : "/clubs";
}

/** The request form's page; an unusable slug falls back to the directory. */
export function clubRequestPage(schoolSlug: string): string {
  return identifierSchema.safeParse(schoolSlug).success
    ? `/schools/${encodeURIComponent(schoolSlug)}/request-club`
    : "/clubs";
}

export type ClaimSearch = { claim?: ClaimOutcome };

export function validateClaimSearch(
  search: Record<string, unknown>,
): ClaimSearch {
  const value = Array.isArray(search.claim) ? search.claim[0] : search.claim;
  return claimOutcomes.includes(value as ClaimOutcome)
    ? { claim: value as ClaimOutcome }
    : {};
}

function validated<T>(
  parsed: { success: true; data: T } | { success: false; error: z.ZodError },
  page: string,
): Validated<T> {
  if (parsed.success) return { valid: true, value: parsed.data };
  const fieldErrors: ClaimFieldErrors = {};
  for (const issue of parsed.error.issues) {
    const field = typeof issue.path[0] === "string" ? issue.path[0] : "_form";
    const messages = fieldErrors[field] ?? [];
    if (!messages.includes(issue.message)) messages.push(issue.message);
    fieldErrors[field] = messages;
  }
  return {
    valid: false,
    page,
    message: "Check the highlighted fields and try again.",
    fieldErrors,
  };
}

function inputValue(input: FormData | object, name: string): string {
  const value =
    input instanceof FormData
      ? input.get(name)
      : name in input
        ? Reflect.get(input, name)
        : undefined;
  return typeof value === "string" ? value.trim() : "";
}
