import * as z from "zod";

const uuidSchema = z.string().uuid();
const timestampSchema = z.iso.datetime({ offset: true });
const cursorSchema = z.string().trim().min(1).max(2048);

export const queueStatusSchema = z.enum([
  "open",
  "in_review",
  "resolved",
  "closed",
]);

const queueWorkflowSchema = z.object({
  status: queueStatusSchema,
  assigned_to_user_id: uuidSchema.optional(),
  retention_started_at: timestampSchema.nullable(),
  created_at: timestampSchema,
  updated_at: timestampSchema,
});

export const reportSummarySchema = queueWorkflowSchema.extend({
  id: uuidSchema,
  reporter_user_id: uuidSchema,
  target_type: z.string().trim().min(1).max(80),
  target_id: uuidSchema,
});

export const reportSchema = reportSummarySchema.extend({
  reason: z.string().max(5000),
  resolution_note: z.string().max(5000),
});

export const supportTicketSummarySchema = queueWorkflowSchema.extend({
  id: uuidSchema,
  submitter_user_id: uuidSchema.optional(),
  submitter_deleted_at: timestampSchema.optional(),
  subject: z.string().max(160),
});

export const supportTicketSchema = supportTicketSummarySchema.extend({
  contact_email: z.email(),
  name: z.string().max(120),
  message: z.string().max(5000),
  resolution_note: z.string().max(5000),
});

export const reportsPageSchema = z.object({
  reports: z.array(reportSummarySchema),
  next_cursor: z.string().max(2048),
  previous_cursor: z.string().max(2048),
});

export const supportTicketsPageSchema = z.object({
  support_tickets: z.array(supportTicketSummarySchema),
  next_cursor: z.string().max(2048),
  previous_cursor: z.string().max(2048),
});

export const auditQueueStateSchema = z.object({
  status: queueStatusSchema,
  assigned_to_user_id: uuidSchema.nullable(),
  retention_started_at: timestampSchema.nullable(),
});

export const auditEntrySchema = z.object({
  id: uuidSchema,
  actor_user_id: uuidSchema.optional(),
  admin_session_id: uuidSchema.optional(),
  request_id: z.string().max(128).optional(),
  action: z.enum(["report.updated", "support_ticket.updated"]),
  entity_type: z.enum(["report", "support_ticket"]),
  entity_id: uuidSchema,
  before: auditQueueStateSchema,
  after: auditQueueStateSchema,
  metadata: z.object({
    resolution_note_changed: z.boolean().optional(),
  }),
  created_at: timestampSchema,
});

export const auditPageSchema = z.object({
  audit_entries: z.array(auditEntrySchema),
  next_cursor: z.string().max(2048),
  previous_cursor: z.string().max(2048),
});

export const queueBrowseInputSchema = z.object({
  status: z
    .union([queueStatusSchema, z.literal("")])
    .transform((value) => value || undefined)
    .optional(),
  assignee: z
    .union([uuidSchema, z.literal("unassigned"), z.literal("")])
    .transform((value) => value || undefined)
    .optional(),
  after: z
    .union([cursorSchema, z.literal("")])
    .transform((value) => value || undefined)
    .optional(),
  before: z
    .union([cursorSchema, z.literal("")])
    .transform((value) => value || undefined)
    .optional(),
});

export const moderationDetailInputSchema = z.object({
  id: uuidSchema,
  audit_after: cursorSchema.optional(),
  audit_before: cursorSchema.optional(),
});

const queueMutationSchema = z.object({
  kind: z.enum(["report", "support-ticket"]),
  id: uuidSchema,
  expected_updated_at: timestampSchema,
  status: queueStatusSchema,
  assigned_to_user_id: z.union([uuidSchema, z.literal("")]),
  resolution_note: z.string().trim().max(5000),
});

export type QueueStatus = z.output<typeof queueStatusSchema>;
export type QueueBrowseInput = z.output<typeof queueBrowseInputSchema>;
export type Report = z.output<typeof reportSchema>;
export type ReportSummary = z.output<typeof reportSummarySchema>;
export type SupportTicket = z.output<typeof supportTicketSchema>;
export type SupportTicketSummary = z.output<typeof supportTicketSummarySchema>;
export type AuditEntry = z.output<typeof auditEntrySchema>;
export type AuditPage = z.output<typeof auditPageSchema>;
export type QueueMutationInput = z.output<typeof queueMutationSchema>;
export type ModerationFieldErrors = Record<string, string[] | undefined>;

export type QueueMutationResult =
  | { status: "success"; redirectTo: string }
  | {
      status: "conflict";
      message: string;
      current: Report | SupportTicket;
    }
  | {
      status: "error";
      message: string;
      fieldErrors?: ModerationFieldErrors;
    };

export type ValidatedQueueMutation =
  | { valid: true; value: QueueMutationInput }
  | {
      valid: false;
      id: string;
      kind: string;
      message: string;
      fieldErrors: ModerationFieldErrors;
    };

export type QueueSearch = QueueBrowseInput;
export type ModerationDetailSearch = {
  audit_after?: string;
  audit_before?: string;
  notice?: "updated" | "update-failed" | "conflict";
};

export function validateQueueSearch(
  search: Record<string, unknown>,
): QueueSearch {
  const parsed = queueBrowseInputSchema.safeParse({
    status: firstString(search.status) || undefined,
    assignee: firstString(search.assignee) || undefined,
    after: firstString(search.after) || undefined,
    before: firstString(search.before) || undefined,
  });
  if (!parsed.success || (parsed.data.after && parsed.data.before)) return {};
  return {
    ...(parsed.data.status ? { status: parsed.data.status } : {}),
    ...(parsed.data.assignee ? { assignee: parsed.data.assignee } : {}),
    ...(parsed.data.after ? { after: parsed.data.after } : {}),
    ...(parsed.data.before ? { before: parsed.data.before } : {}),
  };
}

export function validateModerationDetailSearch(
  search: Record<string, unknown>,
): ModerationDetailSearch {
  const cursor = z.object({
    audit_after: cursorSchema.optional(),
    audit_before: cursorSchema.optional(),
  });
  const parsed = cursor.safeParse({
    audit_after: firstString(search.audit_after) || undefined,
    audit_before: firstString(search.audit_before) || undefined,
  });
  const notice = firstString(search.notice);
  return {
    ...(parsed.success && !(parsed.data.audit_after && parsed.data.audit_before)
      ? {
          ...(parsed.data.audit_after
            ? { audit_after: parsed.data.audit_after }
            : {}),
          ...(parsed.data.audit_before
            ? { audit_before: parsed.data.audit_before }
            : {}),
        }
      : {}),
    ...(notice === "updated" ||
    notice === "update-failed" ||
    notice === "conflict"
      ? { notice }
      : {}),
  };
}

export function validateQueueMutationServerInput(
  input: QueueMutationInput | FormData,
): ValidatedQueueMutation {
  const candidate = {
    kind: inputValue(input, "kind"),
    id: inputValue(input, "id"),
    expected_updated_at: inputValue(input, "expected_updated_at"),
    status: inputValue(input, "status"),
    assigned_to_user_id: inputValue(input, "assigned_to_user_id"),
    resolution_note: inputValue(input, "resolution_note"),
  };
  const parsed = queueMutationSchema.safeParse(candidate);
  if (parsed.success) return { valid: true, value: parsed.data };

  const fieldErrors: ModerationFieldErrors = {};
  for (const issue of parsed.error.issues) {
    const field = typeof issue.path[0] === "string" ? issue.path[0] : "_form";
    const messages = fieldErrors[field] ?? [];
    if (!messages.includes(issue.message)) messages.push(issue.message);
    fieldErrors[field] = messages;
  }
  return {
    valid: false,
    id: candidate.id,
    kind: candidate.kind,
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

function firstString(value: unknown): string {
  if (typeof value === "string") return value;
  return Array.isArray(value) && typeof value[0] === "string" ? value[0] : "";
}
