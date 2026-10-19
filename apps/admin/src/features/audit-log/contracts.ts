import * as z from "zod";
import { auditMetadataSchema, changedFields } from "../catalog/contracts.js";

const uuidSchema = z.string().uuid();
const cursorSchema = z.string().trim().min(1).max(2048);

export const auditLogActionLabels = {
  "report.updated": "Report updated",
  "support_ticket.updated": "Support ticket updated",
  "report.assignee_deleted":
    "Report unassigned: assignee deleted their account",
  "support_ticket.assignee_deleted":
    "Support ticket unassigned: assignee deleted their account",
  "school.created": "School created",
  "school.updated": "School updated",
  "school.deactivated": "School deactivated",
  "school.reactivated": "School reactivated",
  "school.deleted": "School deleted",
  "school.logo_updated": "School logo updated",
  "school.logo_removed": "School logo removed",
  "school_admin.granted": "School-admin access granted",
  "school_admin.revoked": "School-admin access revoked",
  "game.created": "Game created",
  "game.updated": "Game updated",
  "game.deleted": "Game deleted",
  "game.imported": "Game imported from IGDB",
  "game.refreshed": "Game refreshed from IGDB",
  "user.suspended": "Account suspended",
  "user.reactivated": "Account reactivated",
  "user.trust_changed": "Trust level changed",
  "user.password_changed": "Password changed by the account holder",
  "user.email_changed": "Email changed by the account holder",
  "user.data_exported": "Data exported by the account holder",
  "site_role_grant.bootstrapped": "First site admin bootstrapped",
  "site_role_grant.granted": "Site-admin access granted",
  "site_role_grant.revoked": "Site-admin access revoked",
  "club.created": "Club created",
  "club.updated": "Club updated",
  "club.links_replaced": "Club links replaced",
  "club.hidden": "Club hidden",
  "club.unhidden": "Club published again",
  "club.checked": "Club marked as checked",
} as const;

// The kinds of change the log can be narrowed to, by the Admin API's entity
// type.
export const auditLogEntityLabels = {
  report: "Reports",
  support_ticket: "Support tickets",
  school: "Schools",
  school_admin: "School-admin access",
  game: "Games",
  user: "Accounts",
  club: "Clubs",
  site_role_grant: "Site-admin access",
} as const;

type AuditLogEntityType = keyof typeof auditLogEntityLabels;
const auditLogEntityTypes = Object.keys(
  auditLogEntityLabels,
) as AuditLogEntityType[];

export const auditLogEntrySchema = z
  .object({
    id: uuidSchema,
    actor_user_id: uuidSchema.optional(),
    actor_name: z.string().optional(),
    action: z.enum(
      Object.keys(
        auditLogActionLabels,
      ) as (keyof typeof auditLogActionLabels)[],
    ),
    target_type: z.enum([
      "report",
      "support_ticket",
      "school",
      "game",
      "user",
      "club",
    ]),
    target_id: uuidSchema.optional(),
    target_name: z.string().optional(),
    before: z.unknown(),
    after: z.unknown(),
    metadata: auditMetadataSchema,
    created_at: z.iso.datetime({ offset: true }),
  })
  // The browser receives which fields changed and the operator's reason, not
  // the audited values themselves.
  .transform(({ before, after, metadata, ...entry }) => ({
    ...entry,
    reason: metadata?.operator_reason ?? "",
    changed_fields: changedFields(before, after, [
      ...(metadata?.edited_fields ?? []),
      ...(metadata?.resolution_note_changed ? ["resolution_note"] : []),
    ]),
  }));

export const auditLogPageSchema = z.object({
  audit_entries: z.array(auditLogEntrySchema),
  next_cursor: z.string().max(2048),
  previous_cursor: z.string().max(2048),
});

export type AuditLogEntry = z.output<typeof auditLogEntrySchema>;

export type AuditLogSearch = {
  entity_type?: AuditLogEntityType;
  after?: string;
  before?: string;
};

export const auditLogInputSchema = z.object({
  entity_type: z.enum(auditLogEntityTypes).optional(),
  after: cursorSchema.optional(),
  before: cursorSchema.optional(),
});

export function validateAuditLogSearch(
  search: Record<string, unknown>,
): AuditLogSearch {
  const entityType = auditLogEntityTypes.find(
    (value) => value === search.entity_type,
  );
  const after = typeof search.after === "string" ? search.after : "";
  const before = typeof search.before === "string" ? search.before : "";
  return {
    ...(entityType ? { entity_type: entityType } : {}),
    ...(after && !before && after.length <= 2048 ? { after } : {}),
    ...(before && !after && before.length <= 2048 ? { before } : {}),
  };
}
