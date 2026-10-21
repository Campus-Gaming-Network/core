import type { GoalSender } from "../../server/analytics.server.js";
import {
  ApiContractError,
  ApiError,
  type ApiClient,
} from "../../server/api.server.js";
import { loadGameFilterChoices } from "../game-picker/game-filter.server.js";
import { loadSchoolFilterChoices } from "../school-slice/school-filter.server.js";
import { withBundledSchoolLogo } from "../school-slice/school-logos.server.js";
import * as z from "zod";
import { catalogGamesResponseDtoSchema } from "../team-slice/contracts.js";
import {
  acceptedEditorInviteDtoSchema,
  claimFailureMessages,
  clubCommandNotices,
  clubCommandPage,
  clubManagementDtoSchema,
  clubNotices,
  type ClubCommand,
  type ClubCommandResult,
  type ClubManagementResult,
  type ClubNotice,
  type ClubPage,
  claimReceiptDtoSchema,
  clubClaimPage,
  clubDtoSchema,
  clubRequestPage,
  clubsPageSize,
  clubsResponseDtoSchema,
  schoolClubsResponseDtoSchema,
  type ClaimSubmitResult,
  type ClubClaimInput,
  type ClubDetailResult,
  type ClubRequestInput,
  type ClubsBrowsePageInput,
  type ClubsBrowsePageResult,
  type SchoolClubsResult,
} from "./contracts.js";

type PublicDependencies = {
  api: ApiClient;
  reportError?: (error: unknown) => void;
};

/**
 * One published club; a hidden or missing club is not found. With a session
 * the club also says where the viewer stands in it.
 */
export async function clubDetailOperation(
  { slug }: { slug: string },
  {
    api,
    cookieHeader,
    reportError = defaultErrorReporter,
  }: PublicDependencies & { cookieHeader?: string },
): Promise<ClubDetailResult> {
  try {
    const { data } = await api({
      path: `/clubs/${encodeURIComponent(slug)}`,
      cache: "no-store",
      ...(cookieHeader ? { cookieHeader } : {}),
      responseSchema: clubDtoSchema,
    });
    return {
      status: "found",
      club: { ...data, school: withBundledSchoolLogo(data.school) },
    };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return { status: "not_found" };
    }
    reportError(error);
    return { status: "error" };
  }
}

/**
 * A school's published clubs. A failure never fails the school page: it
 * reports itself as unavailable so the page can say so.
 */
export async function schoolClubsOperation(
  { slug }: { slug: string },
  { api, reportError = defaultErrorReporter }: PublicDependencies,
): Promise<SchoolClubsResult> {
  try {
    const { data } = await api({
      path: `/schools/${encodeURIComponent(slug)}/clubs`,
      cache: "no-store",
      responseSchema: schoolClubsResponseDtoSchema,
    });
    return { clubs: data.clubs, unavailable: false };
  } catch (error) {
    reportError(error);
    return { clubs: [], unavailable: true };
  }
}

/**
 * One page of the clubs directory with its school and game filter choices. A
 * failed list never fails the page: it reports itself as unavailable.
 */
export async function clubsBrowsePageOperation(
  { schoolQuery, gameQuery, ...input }: ClubsBrowsePageInput,
  { api, reportError = defaultErrorReporter }: PublicDependencies,
): Promise<ClubsBrowsePageResult> {
  const search = new URLSearchParams();
  if (input.q) search.set("q", input.q);
  if (input.school) search.set("school", input.school);
  if (input.type) search.set("type", input.type);
  if (input.game) search.set("game", input.game);
  search.set("limit", String(clubsPageSize));
  if (input.after) search.set("after", input.after);
  else if (input.before) search.set("before", input.before);

  const [list, schoolFilter, gameFilter] = await Promise.all([
    api({
      path: `/clubs?${search.toString()}`,
      cache: "no-store",
      responseSchema: clubsResponseDtoSchema,
    }).then(
      ({ data }) => ({
        clubs: data.clubs.map((club) => ({
          ...club,
          school: withBundledSchoolLogo(club.school),
        })),
        has_more: data.has_more,
        has_previous: data.has_previous,
        ...(data.next_cursor ? { next_cursor: data.next_cursor } : {}),
        ...(data.previous_cursor
          ? { previous_cursor: data.previous_cursor }
          : {}),
        clubsUnavailable: false,
      }),
      (error: unknown) => {
        reportError(error);
        return {
          clubs: [],
          has_more: false,
          has_previous: false,
          clubsUnavailable: true,
        };
      },
    ),
    loadSchoolFilterChoices(
      api,
      { school: input.school, schoolQuery },
      reportError,
    ),
    loadGameFilterChoices(api, { game: input.game, gameQuery }, reportError),
  ]);
  return { ...list, ...schoolFilter, ...gameFilter };
}

type SessionDependencies = PublicDependencies & { cookieHeader: string };

/** Sends a claim on a listed club for site admins to review. */
export async function submitClubClaimOperation(
  { slug, ...evidence }: ClubClaimInput,
  {
    api,
    cookieHeader,
    reportError = defaultErrorReporter,
  }: SessionDependencies,
): Promise<ClaimSubmitResult> {
  const page = clubClaimPage(slug);
  try {
    await api({
      path: `/clubs/${encodeURIComponent(slug)}/claims`,
      method: "POST",
      cookieHeader,
      body: evidence,
      responseSchema: claimReceiptDtoSchema,
    });
    return { status: "success", redirectTo: `${page}?claim=submitted` };
  } catch (error) {
    reportError(error);
    return claimFailure(error);
  }
}

/** Sends a request for a club the school does not list yet. */
export async function submitClubRequestOperation(
  { school_slug, ...request }: ClubRequestInput,
  {
    api,
    cookieHeader,
    reportError = defaultErrorReporter,
  }: SessionDependencies,
): Promise<ClaimSubmitResult> {
  const page = clubRequestPage(school_slug);
  try {
    await api({
      path: `/schools/${encodeURIComponent(school_slug)}/club-requests`,
      method: "POST",
      cookieHeader,
      body: request,
      responseSchema: claimReceiptDtoSchema,
    });
    return { status: "success", redirectTo: `${page}?claim=submitted` };
  } catch (error) {
    reportError(error);
    return claimFailure(error);
  }
}

function claimFailure(error: unknown): ClaimSubmitResult {
  const outcomes: Record<string, keyof typeof claimFailureMessages> = {
    club_claim_pending: "pending",
    club_already_claimed: "claimed",
    club_already_listed: "listed",
  };
  const outcome =
    error instanceof ApiError ? (outcomes[error.code] ?? "failed") : "failed";
  const messages: Record<string, string> = {
    authentication_required: "Sign in again, then send the form.",
    email_verification_required:
      "Verify your email address first, then send the form.",
    rate_limited: "Too many attempts. Please try again later.",
    invalid_request: "Check the form fields and try again.",
  };
  return {
    status: "error",
    outcome,
    message:
      (error instanceof ApiError ? messages[error.code] : undefined) ??
      claimFailureMessages[outcome],
  };
}

/**
 * The Manage club page: the club, its people, and the catalog games a club
 * can list. A visitor who is not an owner or editor gets "forbidden".
 */
export async function clubManagementOperation(
  { slug }: { slug: string },
  {
    api,
    cookieHeader,
    sessionCookieValue,
    reportError = defaultErrorReporter,
  }: SessionDependencies & { sessionCookieValue?: string },
): Promise<ClubManagementResult> {
  if (!sessionCookieValue) return { status: "unauthenticated" };
  try {
    const [management, games] = await Promise.all([
      api({
        path: `/clubs/${encodeURIComponent(slug)}/manage`,
        cache: "no-store",
        cookieHeader,
        responseSchema: clubManagementDtoSchema,
      }),
      api({
        path: "/games",
        cache: "no-store",
        responseSchema: catalogGamesResponseDtoSchema,
      }),
    ]);
    return {
      status: "found",
      management: management.data,
      games: games.data.games.map(({ id, name }) => ({ id, name })),
    };
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 401) return { status: "unauthenticated" };
      if (error.status === 403) return { status: "forbidden" };
      if (error.status === 404) return { status: "not_found" };
    }
    reportError(error);
    return { status: "error" };
  }
}

/** Sends one club command and names the page and notice to return to. */
export async function runClubCommandOperation(
  command: ClubCommand,
  page: ClubPage,
  {
    api,
    cookieHeader,
    reportError = defaultErrorReporter,
    sendGoal = () => {},
  }: SessionDependencies & { sendGoal?: GoalSender },
): Promise<ClubCommandResult> {
  const club = `/clubs/${encodeURIComponent(command.slug)}`;
  const request = (() => {
    switch (command.command) {
      case "profile": {
        const { command: _, slug: __, ...edit } = command;
        return { path: `${club}/profile`, method: "POST" as const, body: edit };
      }
      case "links":
        return {
          path: `${club}/links`,
          method: "POST" as const,
          body: { links: command.links },
        };
      case "invite":
        return {
          path: `${club}/editor-invites`,
          method: "POST" as const,
          body: { email: command.email },
        };
      case "revoke-invite":
        return {
          path: `${club}/editor-invites/${encodeURIComponent(command.invite_id)}`,
          method: "DELETE" as const,
        };
      case "remove-member":
        return {
          path: `${club}/remove-member`,
          method: "POST" as const,
          body: { user_id: command.user_id },
        };
      case "offer":
        return {
          path: `${club}/ownership-offer`,
          method: "POST" as const,
          body: { user_id: command.user_id },
        };
      case "cancel-offer":
        return { path: `${club}/ownership-offer`, method: "DELETE" as const };
      case "accept-offer":
        return {
          path: `${club}/ownership-offer/accept`,
          method: "POST" as const,
        };
      case "join":
        return { path: `${club}/join`, method: "POST" as const };
      case "leave":
        return { path: `${club}/leave`, method: "POST" as const };
    }
  })();
  try {
    await api({ ...request, cookieHeader, responseSchema: z.unknown() });
    if (command.command === "join") sendGoal({ name: "Join club" });
    // A new owner and someone who left land where they now belong.
    const destination =
      command.command === "accept-offer"
        ? "manage"
        : command.command === "leave" || command.command === "join"
          ? "club"
          : page;
    return {
      status: "success",
      redirectTo: clubCommandPage(
        command.slug,
        destination,
        clubCommandNotices[command.command],
      ),
    };
  } catch (error) {
    if (!(error instanceof ApiError) || error.status >= 500) reportError(error);
    const notice: ClubNotice =
      error instanceof ApiError && error.code === "last_club_owner"
        ? "last-owner"
        : error instanceof ApiError && error.status === 403
          ? "not-allowed"
          : "failed";
    const messages: Record<string, string> = {
      authentication_required: "Sign in again, then try once more.",
      email_verification_required:
        "Verify your email address first, then try once more.",
      club_member_not_found: "That person is no longer in the club.",
      club_owner_cannot_be_removed: "An owner cannot be removed.",
      editor_invite_limit_reached:
        "The club has as many pending invitations as it can. Withdraw one first.",
      editor_invite_not_found: "That invitation was already used or withdrawn.",
      ownership_offer_not_found: "There is no ownership offer to answer.",
      club_game_not_found: "A chosen game is no longer in the catalog.",
      invalid_email: "Enter a valid email address.",
      invalid_request: "Check the form and try again.",
      rate_limited: "Too many attempts. Please try again later.",
    };
    return {
      status: "error",
      notice,
      message:
        (error instanceof ApiError ? messages[error.code] : undefined) ??
        clubNotices[notice].message,
    };
  }
}

/** Accepts an editor invite; the club's Manage page is where it leads. */
export async function acceptEditorInviteOperation(
  { token }: { token: string },
  {
    api,
    cookieHeader,
    reportError = defaultErrorReporter,
  }: SessionDependencies,
): Promise<{ status: "success"; redirectTo: string }> {
  try {
    const { data } = await api({
      path: "/club-editor-invites/accept",
      method: "POST",
      cookieHeader,
      body: { token },
      responseSchema: acceptedEditorInviteDtoSchema,
    });
    return {
      status: "success",
      redirectTo: clubCommandPage(data.club_slug, "manage", "editor"),
    };
  } catch (error) {
    const result =
      error instanceof ApiError && error.code === "editor_invite_wrong_account"
        ? "wrong-account"
        : error instanceof ApiError && error.status === 404
          ? "invalid"
          : "failed";
    if (result === "failed") reportError(error);
    return {
      status: "success",
      redirectTo: `/club-editor-invite?result=${result}`,
    };
  }
}

// Logs what failed without the response body, like the other slices.
function defaultErrorReporter(error: unknown): void {
  if (error instanceof ApiContractError) {
    console.error("Club response contract violation", {
      path: error.path,
      issues: error.issues,
    });
  } else if (!(error instanceof ApiError)) {
    console.error("Club request failed");
  }
}
