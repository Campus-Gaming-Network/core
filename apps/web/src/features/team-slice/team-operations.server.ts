import {
  ApiContractError,
  ApiError,
  type ApiClient
} from "../../server/api.server.js";
import { optionalViewerProfile } from "../../server/viewer.server.js";
import {
  gamesResponseDtoSchema,
  schoolsResponseDtoSchema,
  teamMutationResponseDtoSchema,
  teamDetailResponseDtoSchema,
  teamDtoSchema,
  teamsPageSize,
  teamsResponseDtoSchema,
  type CreateTeamInput,
  type JoinTeamInput,
  type NewTeamPageInput,
  type NewTeamPageResult,
  type SetTeamCaptainInput,
  type TeamDetailResult,
  type TeamMutationResult,
  type TransferTeamOwnershipInput,
  type TeamsBrowseInput,
  type TeamsBrowseResult
} from "./contracts.js";

type Dependencies = {
  api: ApiClient;
  reportError?: (error: unknown) => void;
};

type DetailDependencies = Dependencies & { cookieHeader: string };

type AuthorizedDependencies = DetailDependencies & {
  sessionCookieValue?: string;
};

const emptyTeams = {
  teams: [],
  limit: teamsPageSize,
  has_more: false,
  has_previous: false
};

export async function teamsBrowseOperation(
  input: TeamsBrowseInput,
  { api, reportError = defaultErrorReporter }: Dependencies
): Promise<TeamsBrowseResult> {
  const [teamsResult, gamesResult] = await Promise.all([
    readTeams(api, input)
      .then((data) => ({ data, unavailable: false }))
      .catch((error: unknown) => {
        reportError(error);
        return { data: emptyTeams, unavailable: true };
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
    ...teamsResult.data,
    games: gamesResult.data,
    gamesUnavailable: gamesResult.unavailable,
    teamsUnavailable: teamsResult.unavailable
  };
}

export async function teamDetailOperation(
  { slug }: { slug: string },
  {
    api,
    cookieHeader,
    reportError = defaultErrorReporter
  }: DetailDependencies
): Promise<TeamDetailResult> {
  try {
    const { data } = await api({
      path: `/teams/${encodeURIComponent(slug)}`,
      cookieHeader,
      cache: "no-store",
      responseSchema: teamDetailResponseDtoSchema
    });
    const team = teamDtoSchema.parse(data);
    return {
      status: "found",
      team,
      ...(data.viewer_role ? { viewerRole: data.viewer_role } : {}),
      ...(data.viewer_role === "owner"
        ? { ownerRoster: data.members ?? [] }
        : {})
    };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return { status: "not_found" };
    }
    reportError(error);
    return { status: "error", message: "Team details are unavailable." };
  }
}

export async function newTeamPageOperation(
  { schoolQuery }: NewTeamPageInput,
  {
    api,
    cookieHeader,
    sessionCookieValue,
    reportError = defaultErrorReporter
  }: AuthorizedDependencies
): Promise<NewTeamPageResult> {
  try {
    const profile = await optionalViewerProfile({
      api,
      cookieHeader,
      sessionCookieValue
    });
    if (!profile) return { status: "unauthenticated" };

    const schoolsPromise = schoolQuery.length >= 2
      ? readSchools(api, schoolQuery)
          .then((schools) => ({ schools, failed: false }))
          .catch((error: unknown) => {
            reportError(error);
            return { schools: [], failed: true };
          })
      : Promise.resolve({ schools: [], failed: false });
    const [gamesResult, schoolsResult] = await Promise.all([
      api({
        path: "/games",
        cache: "no-store",
        responseSchema: gamesResponseDtoSchema
      }),
      schoolsPromise
    ]);

    return {
      status: "ready",
      defaultSchoolID: profile.home_school_id,
      games: gamesResult.data.games,
      schools: schoolsResult.schools,
      schoolSearchFailed: schoolsResult.failed
    };
  } catch (error) {
    reportError(error);
    return { status: "error", message: "Team creation is unavailable." };
  }
}

export async function createTeamOperation(
  input: CreateTeamInput,
  dependencies: AuthorizedDependencies
): Promise<TeamMutationResult> {
  return authorizedTeamMutation(
    dependencies,
    () => ({
      path: "/teams",
      method: "POST" as const,
      body: input
    }),
    "created"
  );
}

export async function joinTeamOperation(
  { slug, password }: JoinTeamInput,
  dependencies: AuthorizedDependencies
): Promise<TeamMutationResult> {
  return authorizedTeamMutation(
    dependencies,
    () => ({
      path: `/teams/${encodeURIComponent(slug)}/join`,
      method: "POST" as const,
      body: { password }
    }),
    "joined"
  );
}

export async function setTeamCaptainOperation(
  { slug, user_id, captain }: SetTeamCaptainInput,
  dependencies: AuthorizedDependencies
): Promise<TeamMutationResult> {
  return authorizedTeamMutation(
    dependencies,
    () => ({
      path: `/teams/${encodeURIComponent(slug)}/captains`,
      method: "POST" as const,
      body: { user_id, captain }
    }),
    "captain-updated"
  );
}

export async function transferTeamOwnershipOperation(
  { slug, new_owner_user_id }: TransferTeamOwnershipInput,
  dependencies: AuthorizedDependencies
): Promise<TeamMutationResult> {
  return authorizedTeamMutation(
    dependencies,
    () => ({
      path: `/teams/${encodeURIComponent(slug)}/transfer-ownership`,
      method: "POST" as const,
      body: { new_owner_user_id }
    }),
    "ownership-transferred"
  );
}

async function authorizedTeamMutation(
  {
    api,
    cookieHeader,
    sessionCookieValue,
    reportError = defaultErrorReporter
  }: AuthorizedDependencies,
  request: () => {
    path: string;
    method: "POST";
    body: unknown;
  },
  notice: "created" | "joined" | "captain-updated" | "ownership-transferred"
): Promise<TeamMutationResult> {
  try {
    // The session is derived from the incoming request, never function input.
    // The Go endpoint remains authoritative for owner/member authorization so
    // a forged role or roster selection cannot authorize a management write.
    const profile = await optionalViewerProfile({
      api,
      cookieHeader,
      sessionCookieValue
    });
    if (!profile) {
      return { status: "error", message: "Please log in to continue." };
    }

    const { data } = await api({
      ...request(),
      cookieHeader,
      cache: "no-store",
      responseSchema: teamMutationResponseDtoSchema
    });
    return {
      status: "success",
      redirectTo: `/teams/${encodeURIComponent(data.slug)}?team=${notice}`
    };
  } catch (error) {
    reportError(error);
    return { status: "error", message: safeTeamMutationMessage(error) };
  }
}

export async function readTeams(api: ApiClient, input: TeamsBrowseInput) {
  const search = new URLSearchParams();
  if (input.game) search.set("game", input.game);
  if (input.school) search.set("school", input.school);
  search.set("limit", String(teamsPageSize));
  if (input.after) search.set("after", input.after);
  if (input.before) search.set("before", input.before);

  const { data } = await api({
    path: `/teams?${search.toString()}`,
    cache: "no-store",
    responseSchema: teamsResponseDtoSchema
  });
  return data;
}

async function readSchools(api: ApiClient, query: string) {
  const search = new URLSearchParams({ q: query, limit: "50" });
  const { data } = await api({
    path: `/schools?${search.toString()}`,
    cache: "no-store",
    responseSchema: schoolsResponseDtoSchema
  });
  return data.schools;
}

export function safeTeamMutationMessage(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return "Something went wrong. Please try again.";
  }

  const messages: Record<string, string> = {
    authentication_required: "Please log in to continue.",
    database_unavailable: "The service is starting up. Try again in a moment.",
    invalid_request: "Check the form fields and try again.",
    invalid_team_password: "That team password did not match.",
    invalid_team_role: "Choose a valid team member and role.",
    not_team_owner: "Only the team owner can manage members.",
    rate_limited: "Too many attempts. Give it a minute, then try again.",
    team_captain_failed:
      "We could not update that captain role. Please try again.",
    team_create_failed: "We could not create that team. Please try again.",
    team_game_not_found: "Choose at least one active game from the list.",
    team_join_failed: "We could not join that team. Please try again.",
    team_member_not_found: "Choose an active team member.",
    team_not_found: "That team could not be found.",
    team_school_not_found: "Choose an active school for that team.",
    team_slug_unavailable:
      "That team URL is unavailable. Try changing the name.",
    team_transfer_failed:
      "We could not transfer ownership. Please try again."
  };
  return messages[error.code] ?? "Something went wrong. Please try again.";
}

function defaultErrorReporter(error: unknown): void {
  if (error instanceof ApiContractError) {
    console.error("Team response contract violation", {
      path: error.path,
      issues: error.issues
    });
  } else if (!(error instanceof ApiError)) {
    console.error("Team request failed");
  }
}
