import * as z from "zod";
import {
  AdminApiContractError,
  AdminApiError,
  type ApiClient,
} from "../../server/api.server.js";
import {
  adminGameSchema,
  adminSchoolSchema,
  adminUserSchema,
  catalogAuditPageSchema,
  catalogCommandPage,
  catalogCommands,
  gamesPageSchema,
  logoErrorMessages,
  logoErrorNotices,
  schoolGrantSchema,
  schoolGrantsPageSchema,
  schoolsPageSchema,
  siteGrantSchema,
  siteGrantsPageSchema,
  usersPageSchema,
  type CatalogCommandInput,
  type CatalogMutationResult,
  type CatalogSearch,
  type GameFormInput,
  type LogoUploadInput,
  type SchoolFormInput,
} from "./contracts.js";

type ReadDependencies = {
  api: ApiClient;
  cookieHeader: string;
};

type MutationDependencies = ReadDependencies & {
  headers: HeadersInit;
  reportError?: (error: unknown) => void;
};

type DetailInput = { id: string; audit_after?: string; audit_before?: string };

export async function listSchoolsOperation(
  search: CatalogSearch,
  { api, cookieHeader }: ReadDependencies,
) {
  const { data } = await api({
    path: `/admin/v1/schools${listQuery(search)}`,
    cookieHeader,
    responseSchema: schoolsPageSchema,
  });
  return data;
}

export async function getSchoolDetailOperation(
  input: DetailInput,
  { api, cookieHeader }: ReadDependencies,
  canManageGrants: boolean,
) {
  const id = encodeURIComponent(input.id);
  const [school, audit, grants] = await Promise.all([
    api({
      path: `/admin/v1/schools/${id}`,
      cookieHeader,
      responseSchema: adminSchoolSchema,
    }),
    api({
      path: `/admin/v1/schools/${id}/audit${auditQuery(input)}`,
      cookieHeader,
      responseSchema: catalogAuditPageSchema,
    }),
    canManageGrants
      ? api({
          path: `/admin/v1/schools/${id}/admin-grants?limit=100`,
          cookieHeader,
          responseSchema: schoolGrantsPageSchema,
        })
      : undefined,
  ]);
  return {
    school: school.data,
    audit: audit.data,
    grants: grants?.data.grants,
  };
}

export async function listGamesOperation(
  search: CatalogSearch,
  { api, cookieHeader }: ReadDependencies,
) {
  const { data } = await api({
    path: `/admin/v1/games${listQuery(search)}`,
    cookieHeader,
    responseSchema: gamesPageSchema,
  });
  return data;
}

export async function getGameDetailOperation(
  input: DetailInput,
  { api, cookieHeader }: ReadDependencies,
) {
  const id = encodeURIComponent(input.id);
  const [game, audit] = await Promise.all([
    api({
      path: `/admin/v1/games/${id}`,
      cookieHeader,
      responseSchema: adminGameSchema,
    }),
    api({
      path: `/admin/v1/games/${id}/audit${auditQuery(input)}`,
      cookieHeader,
      responseSchema: catalogAuditPageSchema,
    }),
  ]);
  return { game: game.data, audit: audit.data };
}

export async function listUsersOperation(
  search: CatalogSearch,
  { api, cookieHeader }: ReadDependencies,
) {
  const { data } = await api({
    path: `/admin/v1/users${listQuery(search)}`,
    cookieHeader,
    responseSchema: usersPageSchema,
  });
  return data;
}

export async function getUserDetailOperation(
  input: DetailInput,
  { api, cookieHeader }: ReadDependencies,
) {
  const id = encodeURIComponent(input.id);
  const [user, audit] = await Promise.all([
    api({
      path: `/admin/v1/users/${id}`,
      cookieHeader,
      responseSchema: adminUserSchema,
    }),
    api({
      path: `/admin/v1/users/${id}/audit${auditQuery(input)}`,
      cookieHeader,
      responseSchema: catalogAuditPageSchema,
    }),
  ]);
  return { user: user.data, audit: audit.data };
}

export async function listSiteGrantsOperation(
  search: CatalogSearch,
  { api, cookieHeader }: ReadDependencies,
) {
  const { data } = await api({
    path: `/admin/v1/site-admin-grants${listQuery({ ...search, q: undefined })}`,
    cookieHeader,
    responseSchema: siteGrantsPageSchema,
  });
  return data;
}

export async function saveSchoolOperation(
  { id, expected_updated_at, ...fields }: SchoolFormInput,
  dependencies: MutationDependencies,
): Promise<CatalogMutationResult> {
  const editing = id !== "";
  return mutate(dependencies, {
    request: {
      path: editing
        ? `/admin/v1/schools/${encodeURIComponent(id)}`
        : "/admin/v1/schools",
      method: editing ? "PATCH" : "POST",
      body: editing ? { ...fields, expected_updated_at } : fields,
      responseSchema: adminSchoolSchema,
    },
    destination: (school) =>
      `/schools/${encodeURIComponent(school.id)}?notice=${editing ? "saved" : "created"}`,
    returnPath: editing ? `/schools/${encodeURIComponent(id)}` : "/schools/new",
    reload: editing
      ? { path: `/admin/v1/schools/${encodeURIComponent(id)}` }
      : undefined,
  });
}

export async function saveGameOperation(
  { id, expected_updated_at, ...fields }: GameFormInput,
  dependencies: MutationDependencies,
): Promise<CatalogMutationResult> {
  const editing = id !== "";
  return mutate(dependencies, {
    request: {
      path: editing
        ? `/admin/v1/games/${encodeURIComponent(id)}`
        : "/admin/v1/games",
      method: editing ? "PATCH" : "POST",
      body: editing ? { ...fields, expected_updated_at } : fields,
      responseSchema: adminGameSchema,
    },
    destination: (game) =>
      `/games/${encodeURIComponent(game.id)}?notice=${editing ? "saved" : "created"}`,
    returnPath: editing ? `/games/${encodeURIComponent(id)}` : "/games",
    reload: editing
      ? { path: `/admin/v1/games/${encodeURIComponent(id)}` }
      : undefined,
  });
}

export async function uploadSchoolLogoOperation(
  { id, expected_updated_at, reason, file }: LogoUploadInput,
  dependencies: MutationDependencies,
): Promise<CatalogMutationResult> {
  const school = `/admin/v1/schools/${encodeURIComponent(id)}`;
  // Only the bytes travel on. The Go API ignores the name and declared type,
  // so neither is forwarded.
  const body = new FormData();
  body.set("expected_updated_at", expected_updated_at);
  body.set("reason", reason);
  body.set("file", new Blob([await file.arrayBuffer()]), "logo");
  return mutate(dependencies, {
    request: {
      path: `${school}/logo`,
      method: "POST",
      body,
      responseSchema: adminSchoolSchema,
    },
    destination: () => `/schools/${encodeURIComponent(id)}?notice=logo-updated`,
    returnPath: `/schools/${encodeURIComponent(id)}`,
    reload: { path: school },
  });
}

export async function runCatalogCommandOperation(
  input: CatalogCommandInput,
  dependencies: MutationDependencies,
): Promise<CatalogMutationResult> {
  const page = catalogCommandPage(input.command, input.id, input.user_id);
  if (input.command === "school_grant.grant" && input.user_id === "") {
    const userID = await userIDForEmail(input.user_email, dependencies);
    if (!userID) {
      return {
        status: "error",
        message: "Check the highlighted fields and try again.",
        fieldErrors: { user_email: ["No account uses that email address."] },
      };
    }
    input = { ...input, user_id: userID };
  }
  const { request, reload } = commandRequest(input);
  return mutate(dependencies, {
    request,
    destination: () =>
      `${page}?notice=${catalogCommands[input.command].notice}`,
    returnPath: page,
    reload,
  });
}

/**
 * Resolves an exact email to its account so an operator never handles a user
 * ID. The list search is a prefix match, so the exact address is checked here.
 */
async function userIDForEmail(
  email: string,
  { api, cookieHeader }: ReadDependencies,
): Promise<string | undefined> {
  try {
    const { data } = await api({
      path: `/admin/v1/users?${new URLSearchParams({ limit: "25", q: email })}`,
      cookieHeader,
      responseSchema: usersPageSchema,
    });
    return data.users.find((user) => user.email.toLowerCase() === email)?.id;
  } catch (error) {
    if (error instanceof AdminApiError) return undefined;
    throw error;
  }
}

function commandRequest(input: CatalogCommandInput): {
  request: {
    path: string;
    method: "POST" | "PATCH" | "DELETE";
    body: unknown;
    responseSchema: z.ZodType;
  };
  reload?: { path: string };
} {
  const id = encodeURIComponent(input.id);
  const command = {
    ...(input.expected_updated_at
      ? { expected_updated_at: input.expected_updated_at }
      : {}),
    reason: input.reason,
  };
  const school = `/admin/v1/schools/${id}`;
  const user = `/admin/v1/users/${id}`;

  switch (input.command) {
    case "school.deactivate":
    case "school.reactivate":
      return {
        request: {
          path: `${school}/${input.command === "school.deactivate" ? "deactivate" : "reactivate"}`,
          method: "POST",
          body: command,
          responseSchema: adminSchoolSchema,
        },
        reload: { path: school },
      };
    case "school.delete":
      return {
        request: {
          path: school,
          method: "DELETE",
          body: command,
          responseSchema: adminSchoolSchema,
        },
        reload: { path: school },
      };
    case "school.logo_remove":
      return {
        request: {
          path: `${school}/logo`,
          method: "DELETE",
          body: command,
          responseSchema: adminSchoolSchema,
        },
        reload: { path: school },
      };
    case "school_grant.grant":
      return {
        request: {
          path: `${school}/admin-grants`,
          method: "POST",
          body: { ...command, user_id: input.user_id },
          responseSchema: schoolGrantSchema,
        },
      };
    case "school_grant.revoke":
      return {
        request: {
          path: `${school}/admin-grants/${encodeURIComponent(input.grant_id)}/revoke`,
          method: "POST",
          body: command,
          responseSchema: schoolGrantSchema,
        },
      };
    case "game.delete":
      return {
        request: {
          path: `/admin/v1/games/${id}`,
          method: "DELETE",
          body: command,
          responseSchema: adminGameSchema,
        },
        reload: { path: `/admin/v1/games/${id}` },
      };
    case "user.suspend":
    case "user.reactivate":
      return {
        request: {
          path: `${user}/${input.command === "user.suspend" ? "suspend" : "reactivate"}`,
          method: "POST",
          body: command,
          responseSchema: adminUserSchema,
        },
        reload: { path: user },
      };
    case "user.trust":
      return {
        request: {
          path: `${user}/trust-grants`,
          method: "PATCH",
          body: { ...command, staff_faculty: input.staff_faculty === "true" },
          responseSchema: adminUserSchema,
        },
        reload: { path: user },
      };
    case "site_grant.grant":
      return {
        request: {
          path: "/admin/v1/site-admin-grants",
          method: "POST",
          body: { ...command, user_id: input.user_id },
          responseSchema: siteGrantSchema,
        },
      };
    case "site_grant.revoke":
      return {
        request: {
          path: `/admin/v1/site-admin-grants/${id}/revoke`,
          method: "POST",
          body: command,
          responseSchema: siteGrantSchema,
        },
      };
  }
}

// Messages for the stable Admin API error codes an operator can act on.
const errorMessages: Record<string, string> = {
  ...logoErrorMessages,
  admin_record_already_exists:
    "Another record already uses that slug or IPEDS unit ID.",
  catalog_dependencies_exist:
    "This record is still referenced by events, teams, follows, or grants. Deactivate it instead.",
  invalid_admin_transition:
    "That change is not allowed from the current state.",
  grant_user_not_eligible:
    "That user must have an active, email-verified account.",
  site_role_user_not_eligible:
    "That user must have an active, email-verified account.",
  site_role_grant_already_active: "That user is already a site admin.",
  last_site_admin:
    "This would remove the last active site admin. Grant another admin first.",
  admin_record_not_found: "That record no longer exists.",
};

async function mutate<TSchema extends z.ZodType>(
  {
    api,
    cookieHeader,
    headers,
    reportError = defaultErrorReporter,
  }: MutationDependencies,
  {
    request,
    destination,
    returnPath,
    reload,
  }: {
    request: {
      path: string;
      method: "POST" | "PATCH" | "DELETE";
      body: unknown;
      responseSchema: TSchema;
    };
    destination: (result: z.output<TSchema>) => string;
    returnPath: string;
    reload?: { path: string };
  },
): Promise<CatalogMutationResult> {
  try {
    const { data } = await api({ ...request, cookieHeader, headers });
    return { status: "success", redirectTo: destination(data) };
  } catch (error) {
    if (!(error instanceof AdminApiError)) {
      reportError(error);
      return {
        status: "error",
        message: "The change could not be saved. Try again.",
      };
    }
    if (error.status === 401) return { status: "session-ended" };
    if (error.status === 403 && error.code === "recent_auth_required") {
      return {
        status: "step-up-required",
        redirectTo: `/step-up?return=${encodeURIComponent(returnPath)}`,
      };
    }
    if (error.code === "admin_record_conflict") {
      const current = reload
        ? await api({
            path: reload.path,
            cookieHeader,
            responseSchema: z.object({ updated_at: z.string() }),
          }).catch((readError: unknown) => {
            reportError(readError);
            return undefined;
          })
        : undefined;
      return {
        status: "error",
        message: current
          ? "This record changed after you opened it. Your entries are still in the form; review the current page, then submit again."
          : "This record changed after you opened it. Reload the page before trying again.",
        ...(current ? { currentUpdatedAt: current.data.updated_at } : {}),
      };
    }
    if (errorMessages[error.code]) {
      const notice = Object.hasOwn(logoErrorNotices, error.code)
        ? logoErrorNotices[error.code as keyof typeof logoErrorNotices]
        : undefined;
      return {
        status: "error",
        message: errorMessages[error.code],
        ...(notice ? { notice } : {}),
      };
    }
    if (error.status === 400) {
      return {
        status: "error",
        message: "Check the submitted values and try again.",
      };
    }
    reportError(error);
    return {
      status: "error",
      message: "The change could not be saved. Try again.",
    };
  }
}

function listQuery(search: CatalogSearch): string {
  const query = new URLSearchParams({ limit: "25" });
  if (search.q) query.set("q", search.q);
  if (search.state) query.set("state", search.state);
  if (search.region) query.set("region", search.region);
  if (search.role) query.set("role", search.role);
  if (search.verification) query.set("verification", search.verification);
  if (search.after) query.set("after", search.after);
  if (search.before) query.set("before", search.before);
  return `?${query.toString()}`;
}

function auditQuery(input: {
  audit_after?: string;
  audit_before?: string;
}): string {
  const query = new URLSearchParams({ limit: "25" });
  if (input.audit_after) query.set("after", input.audit_after);
  if (input.audit_before) query.set("before", input.audit_before);
  return `?${query.toString()}`;
}

function defaultErrorReporter(error: unknown): void {
  if (error instanceof AdminApiContractError) {
    console.error("Admin API response contract violation", {
      path: error.path,
    });
  } else if (!(error instanceof AdminApiError)) {
    console.error("Admin catalog request failed");
  }
}
