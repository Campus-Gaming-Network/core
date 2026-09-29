import * as z from "zod";

const uuidSchema = z.string().uuid();
const timestampSchema = z.iso.datetime({ offset: true });
const cursorSchema = z.string().trim().min(1).max(2048);
const pageCursorsSchema = {
  next_cursor: z.string().max(2048),
  previous_cursor: z.string().max(2048),
};

export const adminSchoolSchema = z.object({
  id: uuidSchema,
  unitid: z.number().int().positive().nullable(),
  name: z.string().max(300),
  alias: z.string().max(300),
  slug: z.string().max(120),
  city: z.string().max(100),
  state: z.string().max(80),
  zip: z.string().max(20),
  website_url: z.string().max(2048),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  is_main_campus: z.boolean(),
  num_branches: z.number().int().nonnegative(),
  logo_url: z.string().max(2048),
  is_active: z.boolean(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
  deleted_at: timestampSchema.nullable(),
});

export const adminGameSchema = z.object({
  id: uuidSchema,
  name: z.string().max(200),
  slug: z.string().max(120),
  cover_url: z.string().max(2048).optional(),
  is_active: z.boolean(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
  deleted_at: timestampSchema.nullable(),
});

export const accountStatusSchema = z.enum(["active", "suspended", "deleted"]);

export const adminUserSchema = z.object({
  id: uuidSchema,
  email: z.string().max(320),
  name: z.string().max(200),
  home_school_id: z.string().max(64),
  email_verified_at: timestampSchema.nullable(),
  verification_level: z.string().max(40),
  account_status: accountStatusSchema,
  created_at: timestampSchema,
  updated_at: timestampSchema,
  deleted_at: timestampSchema.nullable(),
  site_admin: z.boolean(),
  school_admin_count: z.number().int().nonnegative(),
});

export const schoolGrantSchema = z.object({
  id: uuidSchema,
  school_id: uuidSchema,
  user_id: uuidSchema,
  created_at: timestampSchema,
  updated_at: timestampSchema,
  revoked_at: timestampSchema.nullable(),
});

export const siteGrantSchema = z.object({
  id: uuidSchema,
  user_id: uuidSchema,
  role: z.literal("site_admin"),
  granted_by_user_id: uuidSchema.optional(),
  grant_reason: z.string().max(1000),
  granted_at: timestampSchema,
  revoked_at: timestampSchema.optional(),
  revoked_by_user_id: uuidSchema.optional(),
  revoke_reason: z.string().max(1000).optional(),
});

export const catalogAuditEntrySchema = z
  .object({
    id: uuidSchema,
    actor_user_id: uuidSchema.optional(),
    action: z.enum([
      "school.created",
      "school.updated",
      "school.deactivated",
      "school.reactivated",
      "school.deleted",
      "school.logo_updated",
      "school.logo_removed",
      "school_admin.granted",
      "school_admin.revoked",
      "game.created",
      "game.updated",
      "game.deleted",
      "user.suspended",
      "user.reactivated",
      "user.trust_changed",
      "site_role_grant.bootstrapped",
      "site_role_grant.granted",
      "site_role_grant.revoked",
    ]),
    before: z.unknown(),
    after: z.unknown(),
    metadata: z
      .object({ operator_reason: z.string().max(1000).optional() })
      .nullish(),
    created_at: timestampSchema,
  })
  // The browser receives which fields changed and the operator's reason, not
  // the audited values themselves.
  .transform(({ before, after, metadata, ...entry }) => ({
    ...entry,
    reason: metadata?.operator_reason ?? "",
    changed_fields: changedFields(before, after),
  }));

function changedFields(before: unknown, after: unknown): string[] {
  const previous = auditState(before);
  const next = auditState(after);
  return [...new Set([...Object.keys(previous), ...Object.keys(next)])].filter(
    (key) => JSON.stringify(previous[key]) !== JSON.stringify(next[key]),
  );
}

function auditState(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export const schoolsPageSchema = z.object({
  schools: z.array(adminSchoolSchema),
  ...pageCursorsSchema,
});
export const gamesPageSchema = z.object({
  games: z.array(adminGameSchema),
  ...pageCursorsSchema,
});
export const usersPageSchema = z.object({
  users: z.array(adminUserSchema),
  ...pageCursorsSchema,
});
export const schoolGrantsPageSchema = z.object({
  grants: z.array(schoolGrantSchema),
  ...pageCursorsSchema,
});
export const siteGrantsPageSchema = z.object({
  grants: z.array(siteGrantSchema),
  ...pageCursorsSchema,
});
export const catalogAuditPageSchema = z.object({
  audit_entries: z.array(catalogAuditEntrySchema),
  ...pageCursorsSchema,
});

export type AdminSchool = z.output<typeof adminSchoolSchema>;
export type AdminGame = z.output<typeof adminGameSchema>;
export type AdminUser = z.output<typeof adminUserSchema>;
export type SchoolGrant = z.output<typeof schoolGrantSchema>;
export type SiteGrant = z.output<typeof siteGrantSchema>;
export type CatalogAuditEntry = z.output<typeof catalogAuditEntrySchema>;
export type CatalogAuditPage = z.output<typeof catalogAuditPageSchema>;
export type CatalogFieldErrors = Record<string, string[] | undefined>;

// List search. Every list accepts a literal prefix search, a state filter,
// and one opaque cursor direction.
export const catalogListKinds = {
  schools: ["active", "inactive", "deleted"],
  games: ["active", "inactive", "deleted"],
  users: ["active", "suspended", "deleted"],
  "site-admins": ["active", "revoked"],
} as const;
export type CatalogListKind = keyof typeof catalogListKinds;

export type CatalogSearch = {
  q?: string;
  state?: string;
  after?: string;
  before?: string;
};

export const catalogBrowseInputSchema = z.object({
  q: z.string().trim().min(2).max(100).optional(),
  state: z.string().max(20).optional(),
  after: cursorSchema.optional(),
  before: cursorSchema.optional(),
});

export function validateCatalogSearch(kind: CatalogListKind) {
  return (search: Record<string, unknown>): CatalogSearch => {
    const q = firstString(search.q).trim();
    const state = firstString(search.state);
    const after = firstString(search.after);
    const before = firstString(search.before);
    const states: readonly string[] = catalogListKinds[kind];
    return {
      ...(q.length >= 2 && q.length <= 100 ? { q } : {}),
      ...(states.includes(state) ? { state } : {}),
      ...(after && !before && after.length <= 2048 ? { after } : {}),
      ...(before && !after && before.length <= 2048 ? { before } : {}),
    };
  };
}

export type CatalogDetailSearch = {
  audit_after?: string;
  audit_before?: string;
  notice?: CatalogNotice;
};

export function validateCatalogDetailSearch(
  search: Record<string, unknown>,
): CatalogDetailSearch {
  const after = firstString(search.audit_after);
  const before = firstString(search.audit_before);
  const notice = firstString(search.notice);
  return {
    ...(after && !before && after.length <= 2048 ? { audit_after: after } : {}),
    ...(before && !after && before.length <= 2048
      ? { audit_before: before }
      : {}),
    ...(Object.hasOwn(catalogNotices, notice)
      ? { notice: notice as CatalogNotice }
      : {}),
  };
}

export const catalogDetailInputSchema = z.object({
  id: uuidSchema,
  audit_after: cursorSchema.optional(),
  audit_before: cursorSchema.optional(),
});

// The Admin API's reasons for rejecting a logo, and the redirect notice a
// no-JavaScript upload shows for each.
export const logoErrorMessages = {
  logo_too_large:
    "The file is larger than 5 MB. Export a smaller PNG or JPEG and try again.",
  logo_unsupported_type:
    "Upload a PNG or JPEG image. SVG, GIF, WebP, and animated images are not accepted.",
  logo_invalid_image:
    "The file could not be read as a complete PNG or JPEG image. Export it again and retry.",
  logo_dimensions_exceeded:
    "The image is larger than 4096 × 4096 pixels or 16 megapixels. Resize it and try again.",
  rate_limited: "Too many attempts. Wait 15 minutes, then try again.",
  logo_storage_unavailable:
    "Logo storage is unavailable right now. Try again later.",
} as const;

export const logoErrorNotices: Partial<
  Record<keyof typeof logoErrorMessages, CatalogNotice>
> = {
  logo_too_large: "logo-too-large",
  logo_unsupported_type: "logo-unsupported",
  logo_invalid_image: "logo-invalid",
  logo_dimensions_exceeded: "logo-dimensions",
  rate_limited: "rate-limited",
};

// Redirect notices shown after a catalog form. Failures render as alerts.
export const catalogNotices = {
  created: { message: "Created.", severity: "success" },
  saved: { message: "Changes saved.", severity: "success" },
  deactivated: { message: "School deactivated.", severity: "success" },
  reactivated: { message: "Reactivated.", severity: "success" },
  deleted: { message: "Deleted.", severity: "success" },
  "grant-added": {
    message: "School-admin access granted.",
    severity: "success",
  },
  "grant-revoked": {
    message: "School-admin access revoked.",
    severity: "success",
  },
  suspended: {
    message: "Account suspended and its sessions ended.",
    severity: "success",
  },
  "trust-changed": { message: "Trust level updated.", severity: "success" },
  "site-admin-granted": {
    message: "Site-admin access granted.",
    severity: "success",
  },
  "site-admin-revoked": {
    message: "Site-admin access revoked and its admin sessions ended.",
    severity: "success",
  },
  "logo-updated": { message: "Logo updated.", severity: "success" },
  "logo-removed": {
    message: "Logo removed. The school shows the placeholder again.",
    severity: "success",
  },
  "logo-too-large": {
    message: logoErrorMessages.logo_too_large,
    severity: "danger",
  },
  "logo-unsupported": {
    message: logoErrorMessages.logo_unsupported_type,
    severity: "danger",
  },
  "logo-invalid": {
    message: logoErrorMessages.logo_invalid_image,
    severity: "danger",
  },
  "logo-dimensions": {
    message: logoErrorMessages.logo_dimensions_exceeded,
    severity: "danger",
  },
  "rate-limited": {
    message: logoErrorMessages.rate_limited,
    severity: "danger",
  },
  "stepped-up": {
    message:
      "Identity confirmed. Protected actions are available for 10 minutes.",
    severity: "success",
  },
  failed: {
    message: "The change could not be saved. Review the fields and try again.",
    severity: "danger",
  },
  conflict: {
    message:
      "This record changed after you opened it. Review the current values, then try again.",
    severity: "danger",
  },
} as const satisfies Record<
  string,
  { message: string; severity: "success" | "danger" }
>;
export type CatalogNotice = keyof typeof catalogNotices;

// School and game forms carry the complete editable record, a reason, and
// the last-seen version when editing.
const reasonSchema = z
  .string()
  .trim()
  .min(1, "Give a reason for the audit log.")
  .max(1000, "Keep the reason to 1000 characters or fewer.");
const slugSchema = z
  .string()
  .trim()
  .max(120)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Use lowercase letters, numbers, and single hyphens.",
  );
const optionalURLSchema = z
  .string()
  .trim()
  .max(2048)
  .refine(
    (value) => value === "" || /^https?:\/\/[^\s/]+/i.test(value),
    "Enter an http or https URL, or leave it blank.",
  );

const schoolFieldsSchema = z
  .object({
    unitid: z
      .string()
      .trim()
      .regex(/^\d*$/, "Use a positive whole number, or leave it blank."),
    name: z
      .string()
      .trim()
      .min(1, "Name is required.")
      .max(300, "Keep the name to 300 characters or fewer."),
    alias: z.string().trim().max(300),
    slug: slugSchema,
    city: z.string().trim().max(100),
    state: z.string().trim().max(80),
    zip: z.string().trim().max(20),
    website_url: optionalURLSchema,
    latitude: z.string().trim(),
    longitude: z.string().trim(),
    is_main_campus: z.boolean(),
    num_branches: z
      .string()
      .trim()
      .regex(/^\d{1,5}$/, "Use a whole number from 0 to 10000."),
    reason: reasonSchema,
  })
  .superRefine((fields, context) => {
    const hasLatitude = fields.latitude !== "";
    const hasLongitude = fields.longitude !== "";
    if (hasLatitude !== hasLongitude) {
      context.addIssue({
        code: "custom",
        path: [hasLatitude ? "longitude" : "latitude"],
        message: "Enter both coordinates, or leave both blank.",
      });
    }
    for (const [field, limit] of [
      ["latitude", 90],
      ["longitude", 180],
    ] as const) {
      const value = fields[field];
      if (value !== "" && !(Math.abs(Number(value)) <= limit)) {
        context.addIssue({
          code: "custom",
          path: [field],
          message: `Enter a number from -${limit} to ${limit}.`,
        });
      }
    }
    if (Number(fields.num_branches) > 10000) {
      context.addIssue({
        code: "custom",
        path: ["num_branches"],
        message: "Use a whole number from 0 to 10000.",
      });
    }
  })
  .transform((fields) => ({
    unitid: fields.unitid ? Number(fields.unitid) : null,
    name: fields.name,
    alias: fields.alias,
    slug: fields.slug,
    city: fields.city,
    state: fields.state,
    zip: fields.zip,
    website_url: fields.website_url,
    latitude: fields.latitude === "" ? null : Number(fields.latitude),
    longitude: fields.longitude === "" ? null : Number(fields.longitude),
    is_main_campus: fields.is_main_campus,
    num_branches: Number(fields.num_branches),
    reason: fields.reason,
  }));

const gameFieldsSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required.")
    .max(200, "Keep the name to 200 characters or fewer."),
  slug: slugSchema,
  cover_url: optionalURLSchema,
  is_active: z.boolean(),
  reason: reasonSchema,
});

const editTargetSchema = z.union([
  z.object({ id: z.literal(""), expected_updated_at: z.literal("") }),
  z.object({ id: uuidSchema, expected_updated_at: timestampSchema }),
]);

export type SchoolFormInput = z.output<typeof schoolFieldsSchema> &
  z.output<typeof editTargetSchema>;
export type GameFormInput = z.output<typeof gameFieldsSchema> &
  z.output<typeof editTargetSchema>;

export type Validated<T> =
  | { valid: true; value: T }
  | {
      valid: false;
      id: string;
      message: string;
      fieldErrors: CatalogFieldErrors;
      notice?: CatalogNotice;
    };

export function validateSchoolFormInput(
  input: FormData | object,
): Validated<SchoolFormInput> {
  return validateRecordForm(input, schoolFieldsSchema, {
    unitid: inputValue(input, "unitid"),
    name: inputValue(input, "name"),
    alias: inputValue(input, "alias"),
    slug: inputValue(input, "slug"),
    city: inputValue(input, "city"),
    state: inputValue(input, "state"),
    zip: inputValue(input, "zip"),
    website_url: inputValue(input, "website_url"),
    latitude: inputValue(input, "latitude"),
    longitude: inputValue(input, "longitude"),
    is_main_campus: checkboxValue(input, "is_main_campus"),
    num_branches: inputValue(input, "num_branches") || "0",
    reason: inputValue(input, "reason"),
  });
}

export function validateGameFormInput(
  input: FormData | object,
): Validated<GameFormInput> {
  return validateRecordForm(input, gameFieldsSchema, {
    name: inputValue(input, "name"),
    slug: inputValue(input, "slug"),
    cover_url: inputValue(input, "cover_url"),
    is_active: checkboxValue(input, "is_active"),
    reason: inputValue(input, "reason"),
  });
}

function validateRecordForm<TSchema extends z.ZodType<object>>(
  input: FormData | object,
  fieldsSchema: TSchema,
  candidate: Record<string, unknown>,
): Validated<z.output<TSchema> & z.output<typeof editTargetSchema>> {
  const id = inputValue(input, "id");
  const target = editTargetSchema.safeParse({
    id,
    expected_updated_at: inputValue(input, "expected_updated_at"),
  });
  const fields = fieldsSchema.safeParse(candidate);
  if (target.success && fields.success) {
    return { valid: true, value: { ...fields.data, ...target.data } };
  }
  return invalid(id, [
    ...(target.success ? [] : target.error.issues),
    ...(fields.success ? [] : fields.error.issues),
  ]);
}

// Named catalog commands. Each maps to one Admin API operation; there is no
// generic record editor. Destructive and high-risk commands require an
// explicit confirmation, and the step-up commands also need recent
// authentication, which the Go API enforces.
export const catalogCommands = {
  "school.deactivate": { confirm: true, stepUp: false, notice: "deactivated" },
  "school.reactivate": { confirm: false, stepUp: false, notice: "reactivated" },
  "school.delete": { confirm: true, stepUp: false, notice: "deleted" },
  "school.logo_remove": {
    confirm: true,
    stepUp: false,
    notice: "logo-removed",
  },
  "school_grant.grant": {
    confirm: false,
    stepUp: false,
    notice: "grant-added",
  },
  "school_grant.revoke": {
    confirm: true,
    stepUp: false,
    notice: "grant-revoked",
  },
  "game.delete": { confirm: true, stepUp: false, notice: "deleted" },
  "user.suspend": { confirm: true, stepUp: true, notice: "suspended" },
  "user.reactivate": { confirm: false, stepUp: true, notice: "reactivated" },
  "user.trust": { confirm: false, stepUp: false, notice: "trust-changed" },
  "site_grant.grant": {
    confirm: true,
    stepUp: true,
    notice: "site-admin-granted",
  },
  "site_grant.revoke": {
    confirm: true,
    stepUp: true,
    notice: "site-admin-revoked",
  },
} as const satisfies Record<
  string,
  { confirm: boolean; stepUp: boolean; notice: CatalogNotice }
>;
export type CatalogCommandName = keyof typeof catalogCommands;

const catalogCommandSchema = z
  .object({
    command: z.enum(
      Object.keys(catalogCommands) as [
        CatalogCommandName,
        ...CatalogCommandName[],
      ],
    ),
    id: uuidSchema,
    grant_id: z.union([uuidSchema, z.literal("")]),
    user_id: z.union([uuidSchema, z.literal("")]),
    expected_updated_at: z.union([timestampSchema, z.literal("")]),
    staff_faculty: z.enum(["true", "false", ""]),
    confirmed: z.boolean(),
    reason: reasonSchema,
  })
  .superRefine((input, context) => {
    const policy = catalogCommands[input.command];
    if (policy.confirm && !input.confirmed) {
      context.addIssue({
        code: "custom",
        path: ["confirmed"],
        message: "Confirm that you intend to make this change.",
      });
    }
    const needsVersion = !(
      input.command === "school_grant.grant" && input.grant_id === ""
    );
    if (needsVersion && input.expected_updated_at === "") {
      context.addIssue({
        code: "custom",
        path: ["expected_updated_at"],
        message: "Reload the page and try again.",
      });
    }
    if (
      (input.command === "school_grant.grant" ||
        input.command === "site_grant.grant") &&
      input.user_id === ""
    ) {
      context.addIssue({
        code: "custom",
        path: ["user_id"],
        message: "Enter the user's ID.",
      });
    }
    if (input.command === "school_grant.revoke" && input.grant_id === "") {
      context.addIssue({
        code: "custom",
        path: ["grant_id"],
        message: "Reload the page and try again.",
      });
    }
    if (input.command === "user.trust" && input.staff_faculty === "") {
      context.addIssue({
        code: "custom",
        path: ["staff_faculty"],
        message: "Choose the staff or faculty setting.",
      });
    }
  });

export type CatalogCommandInput = z.output<typeof catalogCommandSchema>;

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The page that hosts a command's form. A command redirects back to it with a
 * notice, and a step-up returns to it. Unvalidated input falls back to a list.
 */
export function catalogCommandPage(
  command: string,
  id: string,
  userID: string,
): string {
  if (command === "site_grant.revoke") return "/access/site-admins";
  if (command === "site_grant.grant") {
    return uuidPattern.test(userID) ? `/users/${userID}` : "/users";
  }
  const collection = command.startsWith("school")
    ? "schools"
    : command.startsWith("game")
      ? "games"
      : command.startsWith("user")
        ? "users"
        : undefined;
  if (!collection) return "/";
  return uuidPattern.test(id) ? `/${collection}/${id}` : `/${collection}`;
}

export function validateCatalogCommandInput(
  input: FormData | object,
): Validated<CatalogCommandInput> {
  const id = inputValue(input, "id");
  const parsed = catalogCommandSchema.safeParse({
    command: inputValue(input, "command"),
    id,
    grant_id: inputValue(input, "grant_id"),
    user_id: inputValue(input, "user_id"),
    expected_updated_at: inputValue(input, "expected_updated_at"),
    staff_faculty: inputValue(input, "staff_faculty"),
    confirmed: checkboxValue(input, "confirmed"),
    reason: inputValue(input, "reason"),
  });
  return parsed.success
    ? { valid: true, value: parsed.data }
    : invalid(id, parsed.error.issues);
}

export type CatalogMutationResult =
  | { status: "success"; redirectTo: string }
  | { status: "step-up-required"; redirectTo: string }
  | { status: "session-ended" }
  | {
      status: "error";
      message: string;
      fieldErrors?: CatalogFieldErrors;
      /** The current version after a stale write, so a retry can proceed. */
      currentUpdatedAt?: string;
      /** The notice a no-JavaScript form shows instead of the generic one. */
      notice?: CatalogNotice;
    };

/** The encoded upload limit the Go API enforces. */
export const maximumLogoBytes = 5 * 1024 * 1024;

export type LogoUploadInput = {
  id: string;
  expected_updated_at: string;
  reason: string;
  file: File;
};

const logoTargetSchema = z.object({
  id: uuidSchema,
  expected_updated_at: timestampSchema,
  reason: reasonSchema,
});

/**
 * Checks the form around a logo file and its size. Whether the bytes are an
 * acceptable image is decided by the Go API alone, never by the file's name
 * or declared type.
 */
export function validateLogoUploadInput(
  input: FormData | object,
): Validated<LogoUploadInput> {
  const id = inputValue(input, "id");
  const target = logoTargetSchema.safeParse({
    id,
    expected_updated_at: inputValue(input, "expected_updated_at"),
    reason: inputValue(input, "reason"),
  });
  const file = input instanceof FormData ? input.get("file") : null;
  const issues: z.core.$ZodIssue[] = target.success ? [] : target.error.issues;
  const fileMessage =
    !(file instanceof File) || file.size === 0
      ? "Choose a PNG or JPEG file."
      : file.size > maximumLogoBytes
        ? logoErrorMessages.logo_too_large
        : "";
  if (fileMessage) {
    issues.push({
      code: "custom",
      path: ["file"],
      message: fileMessage,
      input: undefined,
    });
  }
  if (target.success && file instanceof File && !fileMessage) {
    return { valid: true, value: { ...target.data, file } };
  }
  const result = invalid(id, issues);
  return file instanceof File && file.size > maximumLogoBytes && !result.valid
    ? { ...result, notice: "logo-too-large" }
    : result;
}

const logoKeyPattern =
  /^school-logos\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{32}\.(?:png|jpg)$/;

/**
 * A stored logo URL is shown as an image only when it is an object key the
 * API generates, under the configured asset origin. Anything else is not
 * rendered, so a tampered record cannot load content from elsewhere.
 */
export function approvedLogoURL(
  logoURL: string,
  assetBase: string | undefined,
): string {
  if (!assetBase || !logoURL.startsWith(`${assetBase}/`)) return "";
  return logoKeyPattern.test(logoURL.slice(assetBase.length + 1))
    ? logoURL
    : "";
}

/** The Go API accepts a step-up for 10 minutes. */
export const recentAuthenticationWindowMs = 10 * 60 * 1000;

export function hasRecentStepUp(
  stepUpAt: string | undefined,
  now: number,
): boolean {
  if (!stepUpAt) return false;
  const elapsed = now - Date.parse(stepUpAt);
  return elapsed >= 0 && elapsed < recentAuthenticationWindowMs;
}

/** Only same-app paths are valid step-up return targets. */
export function safeReturnPath(value: unknown): string {
  const path = firstString(value);
  return /^\/(?![/\\])[\w\-./?=&%]*$/.test(path) && path.length <= 512
    ? path
    : "/";
}

function invalid(
  id: string,
  issues: readonly z.core.$ZodIssue[],
): Validated<never> {
  const fieldErrors: CatalogFieldErrors = {};
  for (const issue of issues) {
    const field = typeof issue.path[0] === "string" ? issue.path[0] : "_form";
    const messages = fieldErrors[field] ?? [];
    if (!messages.includes(issue.message)) messages.push(issue.message);
    fieldErrors[field] = messages;
  }
  return {
    valid: false,
    id,
    message: "Check the highlighted fields and try again.",
    fieldErrors,
  };
}

function inputValue(input: FormData | object, name: string): string {
  const value =
    input instanceof FormData
      ? input.get(name)
      : name in input
        ? Reflect.get(input, name)
        : undefined;
  return typeof value === "string" ? value.trim() : "";
}

function checkboxValue(input: FormData | object, name: string): boolean {
  const value =
    input instanceof FormData
      ? input.get(name)
      : name in input
        ? Reflect.get(input, name)
        : undefined;
  return value === true || value === "on" || value === "true";
}

function firstString(value: unknown): string {
  if (typeof value === "string") return value;
  return Array.isArray(value) && typeof value[0] === "string" ? value[0] : "";
}
