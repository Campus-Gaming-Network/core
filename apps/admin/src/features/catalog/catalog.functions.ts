import { redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import * as z from "zod";
import {
  currentAdminRequest,
  isNativeFormPost,
} from "../../server/admin-request.server.js";
import {
  catalogBrowseInputSchema,
  catalogCommandPage,
  catalogDetailInputSchema,
  validateCatalogCommandInput,
  approvedLogoURL,
  igdbSearchInputSchema,
  validateGameFormInput,
  validateGameImportInput,
  validateLogoUploadInput,
  validateSchoolFormInput,
  type CatalogMutationResult,
  type Validated,
} from "./contracts.js";
import {
  getGameDetailOperation,
  getSchoolDetailOperation,
  getUserDetailOperation,
  importGameOperation,
  listGamesOperation,
  listSchoolsOperation,
  listSiteGrantsOperation,
  listUsersOperation,
  runCatalogCommandOperation,
  saveGameOperation,
  saveSchoolOperation,
  searchIGDBOperation,
  uploadSchoolLogoOperation,
} from "./catalog-operations.server.js";
import { adminEnvironment } from "../../server/environment.server.js";

export const getSchools = createServerFn({ method: "GET" })
  .validator(catalogBrowseInputSchema)
  .handler(({ data }) =>
    listSchoolsOperation(data, currentAdminRequest(false)),
  );

export const getSchoolDetail = createServerFn({ method: "GET" })
  .validator(catalogDetailInputSchema.extend({ include_grants: z.boolean() }))
  .handler(async ({ data }) => {
    const detail = await getSchoolDetailOperation(
      data,
      currentAdminRequest(false),
      data.include_grants,
    );
    return {
      ...detail,
      logoPreviewURL: approvedLogoURL(
        detail.school.logo_url,
        adminEnvironment().logoAssetBase,
      ),
    };
  });

export const getGames = createServerFn({ method: "GET" })
  .validator(catalogBrowseInputSchema)
  .handler(({ data }) => listGamesOperation(data, currentAdminRequest(false)));

export const getGameDetail = createServerFn({ method: "GET" })
  .validator(catalogDetailInputSchema)
  .handler(({ data }) =>
    getGameDetailOperation(data, currentAdminRequest(false)),
  );

export const searchIGDBGames = createServerFn({ method: "GET" })
  .validator(igdbSearchInputSchema)
  .handler(({ data }) =>
    searchIGDBOperation(data.q, currentAdminRequest(false)),
  );

export const importGame = createServerFn({
  method: "POST",
  strict: { input: false },
})
  .validator((input: FormData | object) => validateGameImportInput(input))
  .handler(({ data }) =>
    respond(
      data,
      () => "/games/import",
      (value) => importGameOperation(value, currentAdminRequest(true)),
    ),
  );

export const getUsers = createServerFn({ method: "GET" })
  .validator(catalogBrowseInputSchema)
  .handler(({ data }) => listUsersOperation(data, currentAdminRequest(false)));

export const getUserDetail = createServerFn({ method: "GET" })
  .validator(catalogDetailInputSchema)
  .handler(({ data }) =>
    getUserDetailOperation(data, currentAdminRequest(false)),
  );

export const getSiteGrants = createServerFn({ method: "GET" })
  .validator(catalogBrowseInputSchema)
  .handler(({ data }) =>
    listSiteGrantsOperation(data, currentAdminRequest(false)),
  );

export const saveSchool = createServerFn({
  method: "POST",
  strict: { input: false },
})
  .validator((input: FormData | object) => validateSchoolFormInput(input))
  .handler(({ data }) =>
    respond(
      data,
      (id) => (id ? `/schools/${id}` : "/schools/new"),
      (value) => saveSchoolOperation(value, currentAdminRequest(true)),
    ),
  );

export const saveGame = createServerFn({
  method: "POST",
  strict: { input: false },
})
  .validator((input: FormData | object) => validateGameFormInput(input))
  .handler(({ data }) =>
    respond(
      data,
      (id) => (id ? `/games/${id}` : "/games"),
      (value) => saveGameOperation(value, currentAdminRequest(true)),
    ),
  );

export const uploadSchoolLogo = createServerFn({
  method: "POST",
  strict: { input: false },
})
  .validator((input: FormData | object) => validateLogoUploadInput(input))
  .handler(({ data }) =>
    respond(
      data,
      (id) => (id ? `/schools/${id}` : "/schools"),
      (value) => uploadSchoolLogoOperation(value, currentAdminRequest(true)),
    ),
  );

export const runCatalogCommand = createServerFn({
  method: "POST",
  strict: { input: false },
})
  .validator((input: FormData | object) => ({
    command: formValue(input, "command"),
    userID: formValue(input, "user_id"),
    validated: validateCatalogCommandInput(input),
  }))
  .handler(({ data }) =>
    respond(
      data.validated,
      (id) => catalogCommandPage(data.command, id, data.userID),
      (value) => runCatalogCommandOperation(value, currentAdminRequest(true)),
    ),
  );

// Enhanced submissions receive the result. Native form posts redirect: to
// the result's destination, to step-up, to the shell when the session ended,
// or back to the form's page with a failure notice.
async function respond<T>(
  data: Validated<T>,
  page: (id: string) => string,
  run: (value: T) => Promise<CatalogMutationResult>,
): Promise<CatalogMutationResult> {
  const nativeForm = isNativeFormPost();
  // Only a well-formed ID may reach a redirect path.
  const candidate = data.valid ? (data.value as { id?: unknown }).id : data.id;
  const id =
    typeof candidate === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      candidate,
    )
      ? candidate
      : "";
  if (!data.valid) {
    if (nativeForm)
      nativeRedirect(`${page(id)}?notice=${data.notice ?? "failed"}`);
    return {
      status: "error",
      message: data.message,
      fieldErrors: data.fieldErrors,
    };
  }

  const result = await run(data.value);
  if (nativeForm) {
    nativeRedirect(
      result.status === "success" || result.status === "step-up-required"
        ? result.redirectTo
        : result.status === "session-ended"
          ? "/"
          : `${page(id)}?notice=${result.notice ?? (result.currentUpdatedAt ? "conflict" : "failed")}`,
    );
  }
  return result;
}

function nativeRedirect(href: string): never {
  throw redirect({ href, statusCode: 303 });
}

function formValue(input: FormData | object, name: string): string {
  const value =
    input instanceof FormData
      ? input.get(name)
      : name in input
        ? Reflect.get(input, name)
        : undefined;
  return typeof value === "string" ? value.trim() : "";
}
