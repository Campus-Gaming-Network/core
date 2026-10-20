import { redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import {
  currentSessionRequest,
  goBFFForCurrentRequest,
  isNativeFormPost,
  setPrivateNoStoreResponse,
} from "../../server/request-boundary.server.js";
import { optionalViewerProfile } from "../../server/viewer.server.js";
import {
  clubDetailOperation,
  clubsBrowsePageOperation,
  schoolClubsOperation,
  submitClubClaimOperation,
  submitClubRequestOperation,
} from "./club-operations.server.js";
import {
  clubClaimPage,
  clubRequestPage,
  clubsBrowsePageInputSchema,
  clubSlugInputSchema,
  validateClubClaimServerInput,
  validateClubRequestServerInput,
  type ClaimSubmitResult,
  type Validated,
} from "./contracts.js";

export const getClubsBrowsePage = createServerFn({ method: "GET" })
  .validator(clubsBrowsePageInputSchema)
  .handler(async ({ data }) =>
    clubsBrowsePageOperation(data, { api: goBFFForCurrentRequest() }),
  );

export const getClubDetail = createServerFn({ method: "GET" })
  .validator(clubSlugInputSchema)
  .handler(async ({ data }) =>
    clubDetailOperation(data, { api: goBFFForCurrentRequest() }),
  );

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
