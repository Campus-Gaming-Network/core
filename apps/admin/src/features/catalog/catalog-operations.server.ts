import * as z from "zod";
import {
  AdminApiContractError,
  AdminApiError,
  type ApiClient,
} from "../../server/api.server.js";
import {
  adminClubClaimSchema,
  adminClubSchema,
  catalogNotices,
  clubClaimsPageSchema,
  clubsPageSchema,
  type CatalogNotice,
  type ClubFormInput,
  type ClubLinksInput,
  adminGameSchema,
  adminSchoolDetailSchema,
  adminSchoolSchema,
  adminUserSchema,
  catalogAuditPageSchema,
  catalogCommandPage,
  catalogCommands,
  gameCoverSchema,
  gamesPageSchema,
  igdbErrorMessages,
  igdbErrorNotices,
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
import {
  reportsPageSchema,
  type ReportSummary,
} from "../moderation/contracts.js";

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
      responseSchema: adminSchoolDetailSchema,
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

export async function listClubsOperation(
  search: CatalogSearch,
  { api, cookieHeader }: ReadDependencies,
) {
  const { data } = await api({
    path: `/admin/v1/clubs${listQuery(search)}`,
    cookieHeader,
    responseSchema: clubsPageSchema,
  });
  return data;
}

export async function getClubDetailOperation(
  input: DetailInput,
  { api, cookieHeader }: ReadDependencies,
) {
  const id = encodeURIComponent(input.id);
  const [club, audit] = await Promise.all([
    api({
      path: `/admin/v1/clubs/${id}`,
      cookieHeader,
      responseSchema: adminClubSchema,
    }),
    api({
      path: `/admin/v1/clubs/${id}/audit${auditQuery(input)}`,
      cookieHeader,
      responseSchema: catalogAuditPageSchema,
    }),
  ]);
  return { club: club.data, audit: audit.data };
}

/** One page of club claims, newest first, narrowed by status. */
export async function listClubClaimsOperation(
  search: CatalogSearch,
  { api, cookieHeader }: ReadDependencies,
) {
  const query = new URLSearchParams({ limit: "25" });
  if (search.state) query.set("status", search.state);
  if (search.after) query.set("after", search.after);
  if (search.before) query.set("before", search.before);
  const { data } = await api({
    path: `/admin/v1/club-claims?${query.toString()}`,
    cookieHeader,
    responseSchema: clubClaimsPageSchema,
  });
  return data;
}

export async function getClubClaimDetailOperation(
  input: DetailInput,
  { api, cookieHeader }: ReadDependencies,
) {
  const id = encodeURIComponent(input.id);
  const [claim, audit] = await Promise.all([
    api({
      path: `/admin/v1/club-claims/${id}`,
      cookieHeader,
      responseSchema: adminClubClaimSchema,
    }),
    api({
      path: `/admin/v1/club-claims/${id}/audit${auditQuery(input)}`,
      cookieHeader,
      responseSchema: catalogAuditPageSchema,
    }),
  ]);
  return { claim: claim.data, audit: audit.data };
}

/** The school a new club is created under, by its ID. */
export async function getNewClubSchoolOperation(
  { id }: { id: string },
  { api, cookieHeader }: ReadDependencies,
) {
  const { data } = await api({
    path: `/admin/v1/schools/${encodeURIComponent(id)}`,
    cookieHeader,
    responseSchema: adminSchoolSchema,
  });
  return { id: data.id, name: data.name, is_active: data.is_active };
}

/**
 * Creates or edits a club. Game names typed into the form are matched to the
 * catalog by exact name or slug, ignoring case, so an operator never handles a
 * game ID; a name with no match is reported on the field.
 */
export async function saveClubOperation(
  {
    id,
    expected_updated_at,
    school_id,
    add_games,
    game_ids,
    reason,
    ...fields
  }: ClubFormInput,
  dependencies: MutationDependencies,
): Promise<CatalogMutationResult> {
  const editing = id !== "";
  const returnPath = editing
    ? `/clubs/${encodeURIComponent(id)}`
    : `/clubs/new?school=${encodeURIComponent(school_id)}`;
  const added: string[] = [];
  const unknown: string[] = [];
  for (const name of add_games) {
    // Each name is its own lookup; there are at most 20.
    // eslint-disable-next-line no-await-in-loop
    const gameID = await gameIDForName(name, dependencies);
    if (gameID) added.push(gameID);
    else unknown.push(name);
  }
  if (unknown.length > 0) {
    return {
      status: "error",
      message: "Check the highlighted fields and try again.",
      fieldErrors: {
        add_games: [`No game in the catalog is named ${unknown.join(", ")}.`],
      },
    };
  }
  const body = {
    ...fields,
    game_ids: [...new Set([...game_ids, ...added])],
    reason,
  };
  return mutate(dependencies, {
    request: {
      path: editing
        ? `/admin/v1/clubs/${encodeURIComponent(id)}`
        : "/admin/v1/clubs",
      method: editing ? "PATCH" : "POST",
      body: editing ? { ...body, expected_updated_at } : { ...body, school_id },
      responseSchema: adminClubSchema,
    },
    destination: (club) =>
      `/clubs/${encodeURIComponent(club.id)}?notice=${editing ? "saved" : "created"}`,
    returnPath,
    reload: editing
      ? { path: `/admin/v1/clubs/${encodeURIComponent(id)}` }
      : undefined,
  });
}

export async function saveClubLinksOperation(
  { id, expected_updated_at, links, reason }: ClubLinksInput,
  dependencies: MutationDependencies,
): Promise<CatalogMutationResult> {
  const path = `/admin/v1/clubs/${encodeURIComponent(id)}`;
  return mutate(dependencies, {
    request: {
      path: `${path}/links`,
      method: "POST",
      body: { links, reason, expected_updated_at },
      responseSchema: adminClubSchema,
    },
    destination: (club) =>
      `/clubs/${encodeURIComponent(club.id)}?notice=links-saved`,
    returnPath: `/clubs/${encodeURIComponent(id)}`,
    reload: { path },
  });
}

async function gameIDForName(
  name: string,
  { api, cookieHeader }: ReadDependencies,
): Promise<string | undefined> {
  const { data } = await api({
    path: `/admin/v1/games?${new URLSearchParams({ limit: "25", q: name, state: "active" })}`,
    cookieHeader,
    responseSchema: gamesPageSchema,
  });
  const wanted = name.toLowerCase();
  return data.games.find(
    (game) => game.name.toLowerCase() === wanted || game.slug === wanted,
  )?.id;
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
  const cover = game.data.has_cover
    ? await api({
        path: `/admin/v1/games/${id}/cover`,
        cookieHeader,
        responseSchema: gameCoverSchema,
      })
    : undefined;
  return {
    game: game.data,
    audit: audit.data,
    // A data URL, so the stored cover renders without any remote image.
    coverImage: cover
      ? `data:${cover.data.content_type};base64,${cover.data.data}`
      : undefined,
  };
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

/**
 * A user with their audit history and, when the operator may read reports,
 * every report filed against them.
 */
export async function getUserDetailOperation(
  input: DetailInput,
  { api, cookieHeader }: ReadDependencies,
  includeReports: boolean,
) {
  const id = encodeURIComponent(input.id);
  // The reads run together, but the user's own failure is reported first, so
  // a missing user is a 404 even when the report filter rejects the same ID.
  const [user, audit, reports] = await Promise.allSettled([
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
    includeReports
      ? reportsAgainstUser(input.id, { api, cookieHeader })
      : undefined,
  ]);
  if (user.status === "rejected") throw user.reason;
  if (audit.status === "rejected") throw audit.reason;
  if (reports.status === "rejected") throw reports.reason;
  return {
    user: user.value.data,
    audit: audit.value.data,
    reports: reports.value,
  };
}

// The API pages reports newest first. A user page lists them all, so this
// follows the cursor to the end.
async function reportsAgainstUser(
  userID: string,
  { api, cookieHeader }: ReadDependencies,
): Promise<ReportSummary[]> {
  const reports: ReportSummary[] = [];
  let after = "";
  do {
    const query = new URLSearchParams({ target_user: userID, limit: "100" });
    if (after) query.set("after", after);
    // Each page's cursor comes from the page before it.
    // eslint-disable-next-line no-await-in-loop
    const { data } = await api({
      path: `/admin/v1/reports?${query}`,
      cookieHeader,
      responseSchema: reportsPageSchema,
    });
    reports.push(...data.reports);
    after = data.next_cursor;
  } while (after);
  return reports;
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
  const path = `/admin/v1/games/${encodeURIComponent(id)}`;
  return mutate(dependencies, {
    request: {
      path,
      method: "PATCH",
      body: { ...fields, expected_updated_at },
      responseSchema: adminGameSchema,
    },
    destination: (game) => `/games/${encodeURIComponent(game.id)}?notice=saved`,
    returnPath: `/games/${encodeURIComponent(id)}`,
    reload: { path },
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
  const club = `/admin/v1/clubs/${id}`;

  switch (input.command) {
    case "club_claim.approve":
    case "club_claim.reject": {
      const claim = `/admin/v1/club-claims/${id}`;
      return {
        request: {
          path: `${claim}/${input.command === "club_claim.approve" ? "approve" : "reject"}`,
          method: "POST",
          // A request names the club its approval creates.
          body:
            input.command === "club_claim.approve" && input.club_slug
              ? {
                  ...command,
                  name: input.club_name,
                  slug: input.club_slug,
                  type: input.club_type,
                }
              : command,
          responseSchema: adminClubClaimSchema,
        },
        reload: { path: claim },
      };
    }
    case "club.hide":
    case "club.unhide":
    case "club.check":
      return {
        request: {
          path: `${club}/${{ "club.hide": "hide", "club.unhide": "unhide", "club.check": "mark-checked" }[input.command]}`,
          method: "POST",
          body: command,
          responseSchema: adminClubSchema,
        },
        reload: { path: club },
      };
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
    case "game.refresh":
      return {
        request: {
          path: `/admin/v1/games/${id}/refresh`,
          method: "POST",
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
  ...igdbErrorMessages,
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
  club_game_not_found: "A chosen game is no longer in the catalog.",
  club_already_claimed: catalogNotices["club-already-claimed"].message,
  club_claim_applicant_unavailable:
    catalogNotices["applicant-unavailable"].message,
};

// Claim refusals a no-JavaScript form reports by name.
const claimErrorNotices = {
  club_already_claimed: "club-already-claimed",
  club_claim_applicant_unavailable: "applicant-unavailable",
} as const satisfies Record<string, CatalogNotice>;

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
        : Object.hasOwn(igdbErrorNotices, error.code)
          ? igdbErrorNotices[error.code as keyof typeof igdbErrorNotices]
          : Object.hasOwn(claimErrorNotices, error.code)
            ? claimErrorNotices[error.code as keyof typeof claimErrorNotices]
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
  if (search.school) query.set("school", search.school);
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
