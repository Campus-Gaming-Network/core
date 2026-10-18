import {
  ApiContractError,
  ApiError,
  type ApiClient,
} from "../../server/api.server.js";
import { emptyResponseDtoSchema } from "../event-slice/contracts.js";
import {
  acceptOrganizerInviteResponseDtoSchema,
  organizerInviteDtoSchema,
  organizerInvitesResponseDtoSchema,
  type AcceptOrganizerInviteInput,
  type AcceptOrganizerInviteResult,
  type InviteOrganizerInput,
  type OrganizerInput,
  type OrganizerInvitesResult,
  type OrganizerMutationResult,
  type OrganizerNotice,
  type RevokeOrganizerInviteInput,
} from "./contracts.js";

type Dependencies = {
  api: ApiClient;
  cookieHeader: string;
  reportError?: (error: unknown) => void;
};

function editPage(slug: string, notice: OrganizerNotice): string {
  return `/events/${encodeURIComponent(slug)}/edit?organizers=${notice}#organizers`;
}

function eventsPath(slug: string): string {
  return `/events/${encodeURIComponent(slug)}`;
}

/** The creator's pending invites for the edit page. */
export async function organizerInvitesOperation(
  { slug }: { slug: string },
  { api, cookieHeader, reportError = defaultErrorReporter }: Dependencies,
): Promise<OrganizerInvitesResult> {
  try {
    const { data } = await api({
      path: `${eventsPath(slug)}/organizer-invites`,
      cookieHeader,
      cache: "no-store",
      responseSchema: organizerInvitesResponseDtoSchema,
    });
    return { status: "ready", invites: data.invites };
  } catch (error) {
    reportError(error);
    return { status: "unavailable" };
  }
}

export async function inviteOrganizerOperation(
  { slug, email }: InviteOrganizerInput,
  { api, cookieHeader, reportError = defaultErrorReporter }: Dependencies,
): Promise<OrganizerMutationResult> {
  try {
    await api({
      path: `${eventsPath(slug)}/organizer-invites`,
      method: "POST",
      body: { email },
      cookieHeader,
      cache: "no-store",
      responseSchema: organizerInviteDtoSchema,
    });
    return { status: "success", redirectTo: editPage(slug, "invited") };
  } catch (error) {
    reportError(error);
    const notice: OrganizerNotice =
      error instanceof ApiError && error.code === "organizer_limit_reached"
        ? "invite-limit"
        : error instanceof ApiError && error.code === "invalid_email"
          ? "invalid-email"
          : "failed";
    return { status: "success", redirectTo: editPage(slug, notice) };
  }
}

export function revokeOrganizerInviteOperation(
  { slug, invite_id }: RevokeOrganizerInviteInput,
  dependencies: Dependencies,
): Promise<OrganizerMutationResult> {
  return organizerChange(
    dependencies,
    `${eventsPath(slug)}/organizer-invites/${encodeURIComponent(invite_id)}`,
    "DELETE",
    editPage(slug, "withdrawn"),
    editPage(slug, "failed"),
  );
}

/** The creator removing a co-organizer. */
export function removeOrganizerOperation(
  { slug, user_id }: OrganizerInput,
  dependencies: Dependencies,
): Promise<OrganizerMutationResult> {
  return organizerChange(
    dependencies,
    `${eventsPath(slug)}/organizers/${encodeURIComponent(user_id)}`,
    "DELETE",
    editPage(slug, "removed"),
    editPage(slug, "failed"),
  );
}

/** A co-organizer stepping down, who can no longer open the edit page. */
export function leaveOrganizersOperation(
  { slug, user_id }: OrganizerInput,
  dependencies: Dependencies,
): Promise<OrganizerMutationResult> {
  return organizerChange(
    dependencies,
    `${eventsPath(slug)}/organizers/${encodeURIComponent(user_id)}`,
    "DELETE",
    `${eventsPath(slug)}?event=organizer-left`,
    editPage(slug, "failed"),
  );
}

export function transferCreatorOperation(
  { slug, user_id }: OrganizerInput,
  dependencies: Dependencies,
): Promise<OrganizerMutationResult> {
  return organizerChange(
    dependencies,
    `${eventsPath(slug)}/organizers/${encodeURIComponent(user_id)}/creator`,
    "POST",
    editPage(slug, "transferred"),
    editPage(slug, "failed"),
  );
}

async function organizerChange(
  { api, cookieHeader, reportError = defaultErrorReporter }: Dependencies,
  path: string,
  method: "POST" | "DELETE",
  success: string,
  failure: string,
): Promise<OrganizerMutationResult> {
  try {
    await api({
      path,
      method,
      cookieHeader,
      cache: "no-store",
      responseSchema: emptyResponseDtoSchema,
    });
    return { status: "success", redirectTo: success };
  } catch (error) {
    reportError(error);
    return { status: "success", redirectTo: failure };
  }
}

/**
 * Accepting an invite lands on the event; a failure returns to the invite
 * page, keeping the token so the right account can still use it.
 */
export async function acceptOrganizerInviteOperation(
  { token }: AcceptOrganizerInviteInput,
  { api, cookieHeader, reportError = defaultErrorReporter }: Dependencies,
): Promise<OrganizerMutationResult> {
  try {
    const { data } = await api({
      path: "/organizer-invites/accept",
      method: "POST",
      body: { token },
      cookieHeader,
      cache: "no-store",
      responseSchema: acceptOrganizerInviteResponseDtoSchema,
    });
    return {
      status: "success",
      redirectTo: `${eventsPath(data.event_slug)}?event=organizer-joined`,
    };
  } catch (error) {
    const invitePage = `/organizer-invite?${new URLSearchParams({ token })}`;
    if (error instanceof ApiError && error.status === 401) {
      return {
        status: "success",
        redirectTo: `/login?${new URLSearchParams({ next: invitePage })}`,
      };
    }
    reportError(error);
    let result: AcceptOrganizerInviteResult = "failed";
    if (error instanceof ApiError) {
      if (error.code === "organizer_invite_not_found") result = "invalid";
      if (error.code === "organizer_invite_wrong_account") {
        result = "wrong-account";
      }
    }
    return {
      status: "success",
      redirectTo: `/organizer-invite?${new URLSearchParams({ token, result })}`,
    };
  }
}

function defaultErrorReporter(error: unknown): void {
  if (error instanceof ApiContractError) {
    console.error("Event organizer response contract violation", {
      path: error.path,
      issues: error.issues,
    });
  } else if (!(error instanceof ApiError)) {
    console.error("Event organizer request failed");
  }
}
