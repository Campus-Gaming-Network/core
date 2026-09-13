import { redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import {
  currentSessionRequest,
  goBFFForCurrentRequest,
  isNativeFormPost,
  setPrivateNoStoreResponse,
  setViewerResponseCache
} from "../../server/request-boundary.server.js";
import {
  newTeamPageInputSchema,
  teamSlugInputSchema,
  teamsBrowseInputSchema,
  validateCreateTeamServerInput,
  validateJoinTeamServerInput,
  validateSetTeamCaptainServerInput,
  validateTransferTeamOwnershipServerInput,
  type CreateTeamInput,
  type JoinTeamInput,
  type SetTeamCaptainInput,
  type TransferTeamOwnershipInput
} from "./contracts.js";
import {
  createTeamOperation,
  joinTeamOperation,
  newTeamPageOperation,
  setTeamCaptainOperation,
  teamDetailOperation,
  teamsBrowseOperation,
  transferTeamOwnershipOperation
} from "./team-operations.server.js";

export const getTeamsBrowse = createServerFn({ method: "GET" })
  .validator(teamsBrowseInputSchema)
  .handler(async ({ data }) =>
    teamsBrowseOperation(data, { api: goBFFForCurrentRequest() })
  );

export const getTeamDetail = createServerFn({ method: "GET" })
  .validator(teamSlugInputSchema)
  .handler(async ({ data }) => {
    const request = currentSessionRequest();
    const hasSessionCookie = Boolean(request.sessionCookieValue);
    setViewerResponseCache(hasSessionCookie);
    const result = await teamDetailOperation(data, {
      api: request.api,
      cookieHeader: hasSessionCookie ? request.cookieHeader : ""
    });
    return { ...result, hasSessionCookie };
  });

export const getNewTeamPage = createServerFn({ method: "GET" })
  .validator(newTeamPageInputSchema)
  .handler(async ({ data }) => {
    const request = currentSessionRequest();
    setPrivateNoStoreResponse();
    return newTeamPageOperation(data, request);
  });

export const createTeam = createServerFn({
  method: "POST",
  strict: { input: false }
})
  .validator((input: CreateTeamInput | FormData) =>
    validateCreateTeamServerInput(input)
  )
  .handler(async ({ data }) => {
    setPrivateNoStoreResponse();
    const nativeForm = isNativeFormPost();
    if (!data.valid) {
      if (nativeForm) throwTeamRedirect("/teams/new?team=create-failed");
      return validationFailure(data);
    }

    const result = await createTeamOperation(
      data.value,
      currentSessionRequest()
    );
    if (nativeForm) {
      throwTeamRedirect(
        result.status === "success"
          ? result.redirectTo
          : "/teams/new?team=create-failed"
      );
    }
    return result;
  });

export const joinTeam = createServerFn({
  method: "POST",
  strict: { input: false }
})
  .validator((input: JoinTeamInput | FormData) =>
    validateJoinTeamServerInput(input)
  )
  .handler(async ({ data }) => {
    setPrivateNoStoreResponse();
    const nativeForm = isNativeFormPost();
    if (!data.valid) {
      if (nativeForm) {
        throwTeamRedirect(teamFailureDestination(data.slug, "join-failed"));
      }
      return validationFailure(data);
    }

    const result = await joinTeamOperation(data.value, currentSessionRequest());
    if (nativeForm) {
      throwTeamRedirect(
        result.status === "success"
          ? result.redirectTo
          : teamFailureDestination(data.value.slug, "join-failed")
      );
    }
    return result;
  });

export const setTeamCaptain = createServerFn({
  method: "POST",
  strict: { input: false }
})
  .validator((input: SetTeamCaptainInput | FormData) =>
    validateSetTeamCaptainServerInput(input)
  )
  .handler(async ({ data }) => {
    setPrivateNoStoreResponse();
    const nativeForm = isNativeFormPost();
    if (!data.valid) {
      if (nativeForm) {
        throwTeamRedirect(teamFailureDestination(data.slug, "manage-failed"));
      }
      return validationFailure(data);
    }

    const result = await setTeamCaptainOperation(
      data.value,
      currentSessionRequest()
    );
    if (nativeForm) {
      throwTeamRedirect(
        result.status === "success"
          ? result.redirectTo
          : teamFailureDestination(data.value.slug, "manage-failed")
      );
    }
    return result;
  });

export const transferTeamOwnership = createServerFn({
  method: "POST",
  strict: { input: false }
})
  .validator((input: TransferTeamOwnershipInput | FormData) =>
    validateTransferTeamOwnershipServerInput(input)
  )
  .handler(async ({ data }) => {
    setPrivateNoStoreResponse();
    const nativeForm = isNativeFormPost();
    if (!data.valid) {
      if (nativeForm) {
        throwTeamRedirect(teamFailureDestination(data.slug, "manage-failed"));
      }
      return validationFailure(data);
    }

    const result = await transferTeamOwnershipOperation(
      data.value,
      currentSessionRequest()
    );
    if (nativeForm) {
      throwTeamRedirect(
        result.status === "success"
          ? result.redirectTo
          : teamFailureDestination(data.value.slug, "manage-failed")
      );
    }
    return result;
  });

function validationFailure(data: {
  message: "Check the highlighted fields and try again.";
  fieldErrors: Record<string, string[] | undefined>;
}) {
  return {
    status: "error" as const,
    message: data.message,
    fieldErrors: data.fieldErrors
  };
}

function teamFailureDestination(
  slug: string | undefined,
  notice: "join-failed" | "manage-failed"
): string {
  return slug
    ? `/teams/${encodeURIComponent(slug)}?team=${notice}`
    : `/teams?team=${notice}`;
}

function throwTeamRedirect(href: string): never {
  throw redirect({ href, statusCode: 303 });
}
