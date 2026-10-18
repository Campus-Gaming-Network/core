import { redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import * as z from "zod";
import {
  currentSessionRequest,
  isNativeFormPost,
  setPrivateNoStoreResponse,
} from "../../server/request-boundary.server.js";
import {
  validateAcceptOrganizerInviteInput,
  validateInviteOrganizerInput,
  validateOrganizerInput,
  validateRevokeOrganizerInviteInput,
  type OrganizerMutationResult,
  type ValidatedOrganizerInput,
} from "./contracts.js";
import {
  acceptOrganizerInviteOperation,
  inviteOrganizerOperation,
  leaveOrganizersOperation,
  organizerInvitesOperation,
  removeOrganizerOperation,
  revokeOrganizerInviteOperation,
  transferCreatorOperation,
} from "./organizer-operations.server.js";

export const getOrganizerInvites = createServerFn({ method: "GET" })
  .validator(z.object({ slug: z.string().trim().min(1).max(200) }))
  .handler(async ({ data }) => {
    setPrivateNoStoreResponse();
    return organizerInvitesOperation(data, currentSessionRequest());
  });

export const inviteOrganizer = createServerFn({
  method: "POST",
  strict: { input: false },
})
  .validator((input: object | FormData) => validateInviteOrganizerInput(input))
  .handler(({ data }) =>
    runOrganizerChange(data, inviteOrganizerOperation, "invalid-email"),
  );

export const revokeOrganizerInvite = createServerFn({
  method: "POST",
  strict: { input: false },
})
  .validator((input: object | FormData) =>
    validateRevokeOrganizerInviteInput(input),
  )
  .handler(({ data }) =>
    runOrganizerChange(data, revokeOrganizerInviteOperation, "failed"),
  );

export const removeOrganizer = createServerFn({
  method: "POST",
  strict: { input: false },
})
  .validator((input: object | FormData) => validateOrganizerInput(input))
  .handler(({ data }) =>
    runOrganizerChange(data, removeOrganizerOperation, "failed"),
  );

export const leaveOrganizers = createServerFn({
  method: "POST",
  strict: { input: false },
})
  .validator((input: object | FormData) => validateOrganizerInput(input))
  .handler(({ data }) =>
    runOrganizerChange(data, leaveOrganizersOperation, "failed"),
  );

export const transferEventCreator = createServerFn({
  method: "POST",
  strict: { input: false },
})
  .validator((input: object | FormData) => validateOrganizerInput(input))
  .handler(({ data }) =>
    runOrganizerChange(data, transferCreatorOperation, "failed"),
  );

export const acceptOrganizerInvite = createServerFn({
  method: "POST",
  strict: { input: false },
})
  .validator((input: object | FormData) =>
    validateAcceptOrganizerInviteInput(input),
  )
  .handler(async ({ data }) => {
    setPrivateNoStoreResponse();
    const result: OrganizerMutationResult = data.valid
      ? await acceptOrganizerInviteOperation(
          data.value,
          currentSessionRequest(),
        )
      : { status: "success", redirectTo: "/organizer-invite?result=invalid" };
    return finish(result);
  });

// A native form post always redirects, with a notice naming the outcome; an
// enhanced one returns the destination for the client to navigate to.
async function runOrganizerChange<T>(
  data: ValidatedOrganizerInput<T>,
  operation: (
    input: T,
    dependencies: ReturnType<typeof currentSessionRequest>,
  ) => Promise<OrganizerMutationResult>,
  invalidNotice: "invalid-email" | "failed",
): Promise<OrganizerMutationResult> {
  setPrivateNoStoreResponse();
  const result: OrganizerMutationResult = data.valid
    ? await operation(data.value, currentSessionRequest())
    : {
        status: "success",
        redirectTo: data.slug
          ? `/events/${encodeURIComponent(data.slug)}/edit?organizers=${invalidNotice}#organizers`
          : "/events?event=failed",
      };
  return finish(result);
}

function finish(result: OrganizerMutationResult): OrganizerMutationResult {
  if (isNativeFormPost()) {
    throw redirect({ href: result.redirectTo, statusCode: 303 });
  }
  return result;
}
