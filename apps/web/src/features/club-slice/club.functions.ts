import { redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import {
  currentSessionRequest,
  goBFFForCurrentRequest,
  isNativeFormPost,
  setPrivateNoStoreResponse,
  setViewerResponseCache,
} from "../../server/request-boundary.server.js";
import { optionalViewerProfile } from "../../server/viewer.server.js";
import {
  acceptEditorInviteOperation,
  clubDetailOperation,
  clubManagementOperation,
  runClubCommandOperation,
  clubsBrowsePageOperation,
  schoolClubsOperation,
  submitClubClaimOperation,
  submitClubRequestOperation,
} from "./club-operations.server.js";
import {
  clubClaimPage,
  clubCommandPage,
  clubRequestPage,
  clubsBrowsePageInputSchema,
  clubSlugInputSchema,
  validateClubClaimServerInput,
  validateClubCommandInput,
  validateClubRequestServerInput,
  validateEditorInviteSearch,
  type ClaimSubmitResult,
  type ClubCommandResult,
  type Validated,
} from "./contracts.js";

export const getClubsBrowsePage = createServerFn({ method: "GET" })
  .validator(clubsBrowsePageInputSchema)
  .handler(async ({ data }) =>
    clubsBrowsePageOperation(data, { api: goBFFForCurrentRequest() }),
  );

export const getClubDetail = createServerFn({ method: "GET" })
  .validator(clubSlugInputSchema)
  .handler(async ({ data }) => {
    // A signed-in viewer's page says where they stand in the club, so it is
    // never shared.
    const request = currentSessionRequest();
    setViewerResponseCache(Boolean(request.sessionCookieValue));
    return clubDetailOperation(data, {
      api: request.api,
      cookieHeader: request.cookieHeader,
    });
  });

export const getClubManagement = createServerFn({ method: "GET" })
  .validator(clubSlugInputSchema)
  .handler(async ({ data }) => {
    setPrivateNoStoreResponse();
    return clubManagementOperation(data, currentSessionRequest());
  });

export const runClubCommand = createServerFn({
  method: "POST",
  strict: { input: false },
})
  .validator((input: FormData | object) => validateClubCommandInput(input))
  .handler(async ({ data }): Promise<ClubCommandResult> => {
    setPrivateNoStoreResponse();
    const nativeForm = isNativeFormPost();
    if (!data.valid) {
      if (nativeForm) {
        nativeRedirect(clubCommandPage(data.slug, data.page, "failed"));
      }
      return {
        status: "error",
        notice: "failed",
        message: data.message,
        fieldErrors: data.fieldErrors,
      };
    }
    const result = await runClubCommandOperation(
      data.value,
      data.page,
      currentSessionRequest(),
    );
    if (nativeForm) {
      nativeRedirect(
        result.status === "success"
          ? result.redirectTo
          : clubCommandPage(data.value.slug, data.page, result.notice),
      );
    }
    return result;
  });

export const acceptClubEditorInvite = createServerFn({
  method: "POST",
  strict: { input: false },
})
  .validator((input: FormData | object) =>
    validateEditorInviteSearch({
      token:
        input instanceof FormData
          ? input.get("token")
          : Reflect.get(input, "token"),
    }),
  )
  .handler(async ({ data }) => {
    setPrivateNoStoreResponse();
    const result = data.token
      ? await acceptEditorInviteOperation(
          { token: data.token },
          currentSessionRequest(),
        )
      : {
          status: "success" as const,
          redirectTo: "/club-editor-invite?result=invalid",
        };
    if (isNativeFormPost()) nativeRedirect(result.redirectTo);
    return result;
  });

export const getSchoolClubs = createServerFn({ method: "GET" })
  .validator(clubSlugInputSchema)
  .handler(async ({ data }) =>
    schoolClubsOperation(data, { api: goBFFForCurrentRequest() }),
  );

/** Whether someone is signed in, for the claim and request pages. */
export const getClaimViewer = createServerFn({ method: "GET" }).handler(
  async () => {
    setPrivateNoStoreResponse();
    const profile = await optionalViewerProfile(currentSessionRequest());
    return { signedIn: profile !== null };
  },
);

export const submitClubClaim = createServerFn({
  method: "POST",
  strict: { input: false },
})
  .validator((input: FormData | object) => validateClubClaimServerInput(input))
  .handler(async ({ data }) =>
    respond(
      data,
      (value) => clubClaimPage(value.slug),
      (value) => submitClubClaimOperation(value, currentSessionRequest()),
    ),
  );

export const submitClubRequest = createServerFn({
  method: "POST",
  strict: { input: false },
})
  .validator((input: FormData | object) =>
    validateClubRequestServerInput(input),
  )
  .handler(async ({ data }) =>
    respond(
      data,
      (value) => clubRequestPage(value.school_slug),
      (value) => submitClubRequestOperation(value, currentSessionRequest()),
    ),
  );

// An enhanced submission receives the result. A native form post returns to
// the form's page with the outcome in its query string.
async function respond<T>(
  data: Validated<T>,
  page: (value: T) => string,
  run: (value: T) => Promise<ClaimSubmitResult>,
): Promise<ClaimSubmitResult> {
  setPrivateNoStoreResponse();
  const nativeForm = isNativeFormPost();
  if (!data.valid) {
    if (nativeForm) nativeRedirect(`${data.page}?claim=failed`);
    return {
      status: "error",
      outcome: "failed",
      message: data.message,
      fieldErrors: data.fieldErrors,
    };
  }
  const result = await run(data.value);
  if (nativeForm) {
    nativeRedirect(
      result.status === "success"
        ? result.redirectTo
        : `${page(data.value)}?claim=${result.outcome}`,
    );
  }
  return result;
}

function nativeRedirect(href: string): never {
  throw redirect({ href, statusCode: 303 });
}
