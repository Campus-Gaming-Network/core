import { ApiError, type ApiClient } from "../../server/api.server.js";
import { apiErrorReporter } from "../../server/api-error-reporter.server.js";
import { optionalViewerProfile } from "../../server/viewer.server.js";
import { gamePickerErrorMessages } from "../game-picker/contracts.js";
import { loadGameFilterChoices } from "../game-picker/game-filter.server.js";
import { loadSchoolFilterChoices } from "../school-slice/school-filter.server.js";
import { withBundledSchoolLogo } from "../school-slice/school-logos.server.js";
import {
  catalogGamesResponseDtoSchema,
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
  type LeaveTeamInput,
  type RemoveTeamMemberInput,
  type TeamsBrowseInput,
  type TeamsBrowsePageInput,
  type TeamsBrowsePageResult,
  type TeamsBrowseResult,
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
  has_previous: false,
};

export async function teamsBrowseOperation(
  input: TeamsBrowseInput,
  { api, reportError = defaultErrorReporter }: Dependencies,
): Promise<TeamsBrowseResult> {
  try {
    return { ...(await readTeams(api, input)), teamsUnavailable: false };
  } catch (error) {
    reportError(error);
    return { ...emptyTeams, teamsUnavailable: true };
  }
}

export async function teamsBrowsePageOperation(
  { schoolQuery, gameQuery, ...input }: TeamsBrowsePageInput,
  dependencies: Dependencies,
): Promise<TeamsBrowsePageResult> {
  const { api, reportError = defaultErrorReporter } = dependencies;
  const [browse, schoolFilter, gameFilter] = await Promise.all([
    teamsBrowseOperation(input, dependencies),
    loadSchoolFilterChoices(
      api,
      { school: input.school, schoolQuery },
      reportError,
    ),
    loadGameFilterChoices(api, { game: input.game, gameQuery }, reportError),
  ]);

  return { ...browse, ...schoolFilter, ...gameFilter };
}

export async function teamDetailOperation(
  { slug }: { slug: string },
  { api, cookieHeader, reportError = defaultErrorReporter }: DetailDependencies,
): Promise<TeamDetailResult> {
  try {
    const { data } = await api({
      path: `/teams/${encodeURIComponent(slug)}`,
      cookieHeader,
      cache: "no-store",
      responseSchema: teamDetailResponseDtoSchema,
    });
    const team = teamDtoSchema.parse(data);
    return {
      status: "found",
      team: team.school
        ? { ...team, school: withBundledSchoolLogo(team.school) }
        : team,
      ...(data.viewer_role ? { viewerRole: data.viewer_role } : {}),
      ...(data.viewer_role === "owner"
        ? { ownerRoster: data.members ?? [] }
        : {}),
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
    reportError = defaultErrorReporter,
  }: AuthorizedDependencies,
): Promise<NewTeamPageResult> {
  try {
    const profile = await optionalViewerProfile({
      api,
      cookieHeader,
      sessionCookieValue,
    });
    if (!profile) return { status: "unauthenticated" };

    const schoolsPromise =
      schoolQuery.length >= 2
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
        responseSchema: catalogGamesResponseDtoSchema,
      }),
      schoolsPromise,
    ]);

    return {
      status: "ready",
      defaultSchoolID: profile.home_school_id,
      games: gamesResult.data.games,
      schools: schoolsResult.schools,
      schoolSearchFailed: schoolsResult.failed,
    };
  } catch (error) {
    reportError(error);
    return { status: "error", message: "Team creation is unavailable." };
  }
}

export async function createTeamOperation(
  { idempotency_key, ...input }: CreateTeamInput,
  dependencies: AuthorizedDependencies,
): Promise<TeamMutationResult> {
  return authorizedTeamMutation(
    dependencies,
    () => ({
      path: "/teams",
      method: "POST" as const,
      headers: { "idempotency-key": idempotency_key },
      body: input,
    }),
    "created",
  );
}

export async function joinTeamOperation(
  { slug, password }: JoinTeamInput,
  dependencies: AuthorizedDependencies,
): Promise<TeamMutationResult> {
  return authorizedTeamMutation(
    dependencies,
    () => ({
      path: `/teams/${encodeURIComponent(slug)}/join`,
      method: "POST" as const,
      body: { password },
    }),
    "joined",
  );
}

export async function setTeamCaptainOperation(
  { slug, user_id, captain }: SetTeamCaptainInput,
  dependencies: AuthorizedDependencies,
): Promise<TeamMutationResult> {
  return authorizedTeamMutation(
    dependencies,
    () => ({
      path: `/teams/${encodeURIComponent(slug)}/captains`,
      method: "POST" as const,
      body: { user_id, captain },
    }),
    "captain-updated",
  );
}

export async function transferTeamOwnershipOperation(
  { slug, new_owner_user_id }: TransferTeamOwnershipInput,
  dependencies: AuthorizedDependencies,
): Promise<TeamMutationResult> {
  return authorizedTeamMutation(
    dependencies,
    () => ({
      path: `/teams/${encodeURIComponent(slug)}/transfer-ownership`,
      method: "POST" as const,
      body: { new_owner_user_id },
    }),
    "ownership-transferred",
  );
}

export async function leaveTeamOperation(
  { slug }: LeaveTeamInput,
  dependencies: AuthorizedDependencies,
): Promise<TeamMutationResult> {
  return authorizedTeamMutation(
    dependencies,
    () => ({
      path: `/teams/${encodeURIComponent(slug)}/leave`,
      method: "POST" as const,
      body: {},
    }),
    "left",
  );
}

export async function removeTeamMemberOperation(
  { slug, user_id }: RemoveTeamMemberInput,
  dependencies: AuthorizedDependencies,
): Promise<TeamMutationResult> {
  return authorizedTeamMutation(
    dependencies,
    () => ({
      path: `/teams/${encodeURIComponent(slug)}/remove-member`,
      method: "POST" as const,
      body: { user_id },
    }),
    "member-removed",
  );
}

async function authorizedTeamMutation(
  {
    api,
    cookieHeader,
    sessionCookieValue,
    reportError = defaultErrorReporter,
  }: AuthorizedDependencies,
  request: () => {
    path: string;
    method: "POST";
    headers?: HeadersInit;
    body: unknown;
  },
  notice:
    | "created"
    | "joined"
    | "captain-updated"
    | "ownership-transferred"
    | "left"
    | "member-removed",
): Promise<TeamMutationResult> {
  try {
    // The session is derived from the incoming request, never function input.
    // The Go endpoint remains authoritative for owner/member authorization so
    // a forged role or roster selection cannot authorize a management write.
    const profile = await optionalViewerProfile({
      api,
      cookieHeader,
      sessionCookieValue,
    });
    if (!profile) {
      return { status: "error", message: "Please log in to continue." };
    }

    const { data } = await api({
      ...request(),
      cookieHeader,
      cache: "no-store",
      responseSchema: teamMutationResponseDtoSchema,
    });
    return {
      status: "success",
      redirectTo: `/teams/${encodeURIComponent(data.slug)}?team=${notice}`,
    };
  } catch (error) {
    reportError(error);
    return { status: "error", message: safeTeamMutationMessage(error) };
  }
}

async function readTeams(api: ApiClient, input: TeamsBrowseInput) {
  const search = new URLSearchParams();
  if (input.game) search.set("game", input.game);
  if (input.school) search.set("school", input.school);
  search.set("limit", String(teamsPageSize));
  if (input.after) search.set("after", input.after);
  if (input.before) search.set("before", input.before);

  const { data } = await api({
    path: `/teams?${search.toString()}`,
    cache: "no-store",
    responseSchema: teamsResponseDtoSchema,
  });
  return data;
}

async function readSchools(api: ApiClient, query: string) {
  const search = new URLSearchParams({ q: query, limit: "50" });
  const { data } = await api({
    path: `/schools?${search.toString()}`,
    cache: "no-store",
    responseSchema: schoolsResponseDtoSchema,
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
    idempotency_key_reused:
      "This form was already submitted. Reload the page and try again.",
    ...gamePickerErrorMessages,
    invalid_request: "Check the form fields and try again.",
    invalid_team_password: "That team password did not match.",
    invalid_team_role: "Choose a valid team member and role.",
    not_team_owner: "Only the team owner can manage members.",
    rate_limited: "Too many attempts. Please try again later.",
    team_captain_failed:
      "We could not update that captain role. Please try again.",
    team_create_failed: "We could not create that team. Please try again.",
    team_game_not_found: "Choose at least one active game from the list.",
    team_join_failed: "We could not join that team. Please try again.",
    team_leave_failed: "We could not take you off that team. Please try again.",
    team_owner_cannot_leave:
      "Transfer ownership to another member before you leave the team.",
    team_remove_member_failed:
      "We could not remove that member. Please try again.",
    team_member_not_found: "Choose an active team member.",
    team_not_found: "That team could not be found.",
    team_school_not_found: "Choose an active school for that team.",
    team_slug_unavailable:
      "That team URL is unavailable. Try changing the name.",
    team_transfer_failed: "We could not transfer ownership. Please try again.",
  };
  return messages[error.code] ?? "Something went wrong. Please try again.";
}

const defaultErrorReporter = apiErrorReporter("Team");
