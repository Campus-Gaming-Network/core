import * as z from "zod";

const identifierSchema = z.string().trim().min(1).max(200);
const nonNegativeIntegerSchema = z.number().int().nonnegative();
const filterSchema = z.string().trim().max(200);
const cursorSchema = z.string().trim().max(2048);

export const teamsPageSize = 25;

export const teamRoleSchema = z.enum(["owner", "captain", "member"]);

export const schoolSummaryDtoSchema = z.object({
  id: identifierSchema,
  name: z.string(),
  slug: identifierSchema,
  city: z.string().optional(),
  state: z.string().optional()
});

export const gameSummaryDtoSchema = z.object({
  id: identifierSchema,
  name: z.string(),
  slug: identifierSchema
});

/** Public team fields allowed to cross the Start loader boundary. */
export const teamDtoSchema = z.object({
  id: identifierSchema,
  name: z.string(),
  slug: identifierSchema,
  description: z.string(),
  member_count: nonNegativeIntegerSchema,
  school: schoolSummaryDtoSchema.optional(),
  games: z.array(gameSummaryDtoSchema)
});

export const teamMemberDtoSchema = z.object({
  user_id: identifierSchema,
  name: z.string(),
  role: teamRoleSchema
});

/**
 * The detail endpoint may add viewer-specific role and roster data. The
 * operation exposes the minimal roster only when the API-derived role is
 * owner; Zod strips owner IDs, member account data, and all other additions.
 */
export const teamDetailResponseDtoSchema = teamDtoSchema.extend({
  viewer_role: teamRoleSchema.optional(),
  members: z.array(teamMemberDtoSchema).optional()
});

export const teamsResponseDtoSchema = z.object({
  teams: z.array(teamDtoSchema),
  limit: nonNegativeIntegerSchema,
  has_more: z.boolean(),
  has_previous: z.boolean(),
  next_cursor: z.string().min(1).optional(),
  previous_cursor: z.string().min(1).optional()
});

export const gamesResponseDtoSchema = z.object({
  games: z.array(gameSummaryDtoSchema)
});

export const schoolsResponseDtoSchema = z.object({
  schools: z.array(schoolSummaryDtoSchema),
  limit: nonNegativeIntegerSchema,
  offset: nonNegativeIntegerSchema,
  has_more: z.boolean()
});

export const teamsBrowseInputSchema = z.object({
  game: filterSchema,
  school: filterSchema,
  after: cursorSchema,
  before: cursorSchema
});

export const teamSlugInputSchema = z.object({ slug: identifierSchema });

const teamNameSchema = z
  .string()
  .trim()
  .min(1, "Team name is required.")
  .max(120, "Team name must be 120 characters or fewer.");
const teamDescriptionSchema = z
  .string()
  .trim()
  .max(5000, "Description must be 5000 characters or fewer.");
const teamPasswordSchema = z
  .string()
  .trim()
  .min(8, "Password must be at least 8 characters.")
  .max(200, "Password must be 200 characters or fewer.");

export const createTeamInputSchema = z.object({
  name: teamNameSchema,
  description: teamDescriptionSchema,
  school_id: z.string().trim().max(200),
  game_ids: z
    .array(identifierSchema)
    .min(1, "Choose at least one game.")
    .max(25, "Choose 25 games or fewer."),
  password: teamPasswordSchema
});

export const joinTeamInputSchema = teamSlugInputSchema.extend({
  password: teamPasswordSchema
});

export const setTeamCaptainInputSchema = teamSlugInputSchema.extend({
  user_id: identifierSchema,
  captain: z.boolean()
});

export const transferTeamOwnershipInputSchema = teamSlugInputSchema.extend({
  new_owner_user_id: identifierSchema
});

export const newTeamPageInputSchema = z.object({
  schoolQuery: filterSchema
});

export const teamMutationResponseDtoSchema = z.object({ slug: identifierSchema });

export type TeamDTO = z.output<typeof teamDtoSchema>;
export type TeamRole = z.output<typeof teamRoleSchema>;
export type GameSummaryDTO = z.output<typeof gameSummaryDtoSchema>;
export type SchoolSummaryDTO = z.output<typeof schoolSummaryDtoSchema>;
export type TeamMemberDTO = z.output<typeof teamMemberDtoSchema>;
export type TeamsBrowseInput = z.output<typeof teamsBrowseInputSchema>;
export type CreateTeamInput = z.output<typeof createTeamInputSchema>;
export type JoinTeamInput = z.output<typeof joinTeamInputSchema>;
export type SetTeamCaptainInput = z.output<typeof setTeamCaptainInputSchema>;
export type TransferTeamOwnershipInput = z.output<
  typeof transferTeamOwnershipInputSchema
>;
export type NewTeamPageInput = z.output<typeof newTeamPageInputSchema>;

export type TeamsSearch = {
  game?: string;
  school?: string;
  after?: string;
  before?: string;
  team?: "manage-failed";
};

export type TeamNotice =
  | "captain-updated"
  | "created"
  | "joined"
  | "join-failed"
  | "manage-failed"
  | "ownership-transferred";

export type TeamDetailSearch = { team?: TeamNotice };

export type NewTeamSearch = {
  school_q?: string;
  team?: "create-failed";
};

export type TeamsBrowseResult = z.output<typeof teamsResponseDtoSchema> & {
  games: GameSummaryDTO[];
  gamesUnavailable: boolean;
  teamsUnavailable: boolean;
};

export type TeamDetailResult =
  | {
      status: "found";
      team: TeamDTO;
      viewerRole?: TeamRole;
      ownerRoster?: TeamMemberDTO[];
    }
  | { status: "not_found" }
  | { status: "error"; message: "Team details are unavailable." };

export type TeamViewerState = "anonymous" | "non_member" | TeamRole;

export type NewTeamPageResult =
  | {
      status: "ready";
      defaultSchoolID: string;
      games: GameSummaryDTO[];
      schools: SchoolSummaryDTO[];
      schoolSearchFailed: boolean;
    }
  | { status: "unauthenticated" }
  | { status: "error"; message: "Team creation is unavailable." };

export type TeamMutationResult =
  | { status: "success"; redirectTo: string }
  | { status: "error"; message: string; fieldErrors?: TeamFieldErrors };

export type TeamFieldErrors = Record<string, string[] | undefined>;

export type ValidatedTeamInput<T> =
  | { valid: true; value: T }
  | {
      valid: false;
      message: "Check the highlighted fields and try again.";
      fieldErrors: TeamFieldErrors;
      slug?: string;
    };

export function validateTeamsSearch(
  search: Record<string, unknown>
): TeamsSearch {
  const game = tolerantSearchValue(search.game, 200);
  const school = tolerantSearchValue(search.school, 200);
  const after = tolerantSearchValue(search.after, 2048);
  const before = tolerantSearchValue(search.before, 2048);
  const team = tolerantSearchValue(search.team, 64);

  return {
    ...(game ? { game } : {}),
    ...(school ? { school } : {}),
    ...(after ? { after } : {}),
    ...(before ? { before } : {}),
    ...(team === "manage-failed" ? { team } : {})
  };
}

export function teamsBrowseInput(search: TeamsSearch): TeamsBrowseInput {
  return {
    game: search.game ?? "",
    school: search.school ?? "",
    after: search.after ?? "",
    before: search.before ?? ""
  };
}

export function validateTeamDetailSearch(
  search: Record<string, unknown>
): TeamDetailSearch {
  const team = tolerantSearchValue(search.team, 64);
  return team === "captain-updated" ||
    team === "created" ||
    team === "joined" ||
    team === "join-failed" ||
    team === "manage-failed" ||
    team === "ownership-transferred"
    ? { team }
    : {};
}

export function validateNewTeamSearch(
  search: Record<string, unknown>
): NewTeamSearch {
  const schoolQuery = tolerantSearchValue(search.school_q, 200);
  const team = tolerantSearchValue(search.team, 64);
  return {
    ...(schoolQuery ? { school_q: schoolQuery } : {}),
    ...(team === "create-failed" ? { team } : {})
  };
}

export function validateCreateTeamServerInput(
  input: CreateTeamInput | FormData
): ValidatedTeamInput<CreateTeamInput> {
  const candidate = {
    name: inputValue(input, "name"),
    description: inputValue(input, "description"),
    school_id: inputValue(input, "school_id"),
    game_ids: inputValues(input, "game_ids"),
    password: inputValue(input, "password")
  };
  return validationResult(createTeamInputSchema.safeParse(candidate));
}

export function validateJoinTeamServerInput(
  input: JoinTeamInput | FormData
): ValidatedTeamInput<JoinTeamInput> {
  const candidate = {
    slug: inputValue(input, "slug"),
    password: inputValue(input, "password")
  };
  return validationResult(
    joinTeamInputSchema.safeParse(candidate),
    validFailureSlug(candidate.slug)
  );
}

export function validateSetTeamCaptainServerInput(
  input: SetTeamCaptainInput | FormData
): ValidatedTeamInput<SetTeamCaptainInput> {
  const rawCaptain = inputValue(input, "captain");
  const candidate = {
    slug: inputValue(input, "slug"),
    user_id: inputValue(input, "user_id"),
    captain:
      typeof input === "object" &&
      !(input instanceof FormData) &&
      typeof input.captain === "boolean"
        ? input.captain
        : rawCaptain === "true"
          ? true
          : rawCaptain === "false"
            ? false
            : rawCaptain
  };
  return validationResult(
    setTeamCaptainInputSchema.safeParse(candidate),
    validFailureSlug(candidate.slug)
  );
}

export function validateTransferTeamOwnershipServerInput(
  input: TransferTeamOwnershipInput | FormData
): ValidatedTeamInput<TransferTeamOwnershipInput> {
  const candidate = {
    slug: inputValue(input, "slug"),
    new_owner_user_id: inputValue(input, "new_owner_user_id")
  };
  return validationResult(
    transferTeamOwnershipInputSchema.safeParse(candidate),
    validFailureSlug(candidate.slug)
  );
}

function validationResult<T>(
  parsed: z.ZodSafeParseResult<T>,
  slug?: string
): ValidatedTeamInput<T> {
  if (parsed.success) return { valid: true, value: parsed.data };
  const fieldErrors: TeamFieldErrors = {};
  for (const issue of parsed.error.issues) {
    const field = String(issue.path[0] ?? "form");
    const messages = fieldErrors[field] ?? [];
    if (!messages.includes(issue.message)) messages.push(issue.message);
    fieldErrors[field] = messages;
  }
  return {
    valid: false,
    message: "Check the highlighted fields and try again.",
    fieldErrors,
    ...(slug ? { slug } : {})
  };
}

function inputValue(input: object | FormData, field: string): string {
  if (input instanceof FormData) {
    const value = input.get(field);
    return typeof value === "string" ? value : "";
  }
  const value = (input as Record<string, unknown>)[field];
  return typeof value === "string" ? value : "";
}

function inputValues(input: object | FormData, field: string): string[] {
  const values = input instanceof FormData
    ? input.getAll(field)
    : (input as Record<string, unknown>)[field];
  return (Array.isArray(values) ? values : [])
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim());
}

function validFailureSlug(value: string): string | undefined {
  return identifierSchema.safeParse(value).success ? value.trim() : undefined;
}

function tolerantSearchValue(value: unknown, maximumLength: number): string {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (typeof candidate !== "string") return "";
  const normalized = candidate.trim();
  return normalized.length <= maximumLength ? normalized : "";
}
