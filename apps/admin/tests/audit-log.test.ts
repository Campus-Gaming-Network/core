import assert from "node:assert/strict";
import test from "node:test";
import { listAuditLogOperation } from "../src/features/audit-log/audit-log-operations.server.js";
import {
  auditLogPageSchema,
  validateAuditLogSearch,
} from "../src/features/audit-log/contracts.js";
import type { ApiClient } from "../src/server/api.server.js";

const entryID = "11111111-1111-4111-8111-111111111111";
const userID = "22222222-2222-4222-8222-222222222222";
const ticketID = "33333333-3333-4333-8333-333333333333";
const createdAt = "2026-09-20T12:00:00Z";

test("the audit log requests one filtered page and withholds audited values", async () => {
  const paths: string[] = [];
  const api = (async (options) => {
    paths.push(options.path);
    return {
      data: options.responseSchema.parse({
        audit_entries: [
          {
            id: entryID,
            actor_user_id: userID,
            actor_name: "Operator",
            admin_session_id: entryID,
            request_id: "request-1",
            action: "support_ticket.updated",
            entity_type: "support_ticket",
            entity_id: ticketID,
            target_type: "support_ticket",
            target_id: ticketID,
            before: { status: "open", assigned_to_user_id: null },
            after: { status: "resolved", assigned_to_user_id: null },
            metadata: { resolution_note_changed: true },
            created_at: createdAt,
          },
        ],
        next_cursor: "older",
        previous_cursor: "",
      }),
      response: Response.json({}),
    };
  }) as ApiClient;

  assert.deepEqual(
    {
      page: await listAuditLogOperation(
        { entity_type: "support_ticket", after: "cursor" },
        { api, cookieHeader: "admin" },
      ),
      paths,
    },
    {
      page: {
        audit_entries: [
          {
            id: entryID,
            actor_user_id: userID,
            actor_name: "Operator",
            action: "support_ticket.updated",
            target_type: "support_ticket",
            target_id: ticketID,
            created_at: createdAt,
            reason: "",
            changed_fields: ["status", "resolution_note"],
          },
        ],
        next_cursor: "older",
        previous_cursor: "",
      },
      paths: [
        "/admin/v1/audit?limit=25&entity_type=support_ticket&after=cursor",
      ],
    },
  );
});

test("an audit log entry with an unknown action fails the contract", () => {
  assert.equal(
    auditLogPageSchema.safeParse({
      audit_entries: [
        {
          id: entryID,
          action: "event.deleted",
          target_type: "school",
          before: {},
          after: {},
          created_at: createdAt,
        },
      ],
      next_cursor: "",
      previous_cursor: "",
    }).success,
    false,
  );
});

test("audit log searches keep a known entity type and one cursor direction", () => {
  assert.deepEqual(
    [
      validateAuditLogSearch({ entity_type: "game", after: "next" }),
      validateAuditLogSearch({ entity_type: "event", before: "previous" }),
      validateAuditLogSearch({ after: "next", before: "previous" }),
    ],
    [{ entity_type: "game", after: "next" }, { before: "previous" }, {}],
  );
});

test("what people do to their own account reads as entries with no values", () => {
  const entries = [
    "user.password_changed",
    "user.email_changed",
    "user.data_exported",
  ].map((action) => ({
    id: entryID,
    actor_user_id: userID,
    actor_name: "Player",
    action,
    target_type: "user",
    target_id: userID,
    before: {},
    after: {},
    metadata: {},
    created_at: createdAt,
  }));

  assert.deepEqual(
    auditLogPageSchema.parse({
      audit_entries: entries,
      next_cursor: "",
      previous_cursor: "",
    }).audit_entries,
    entries.map(({ action }) => ({
      id: entryID,
      actor_user_id: userID,
      actor_name: "Player",
      action,
      target_type: "user",
      target_id: userID,
      created_at: createdAt,
      reason: "",
      changed_fields: [],
    })),
  );
});

test("an audit entry lists the fields the admin changed without bookkeeping timestamps", () => {
  const schoolID = "44444444-4444-4444-8444-444444444444";
  const entry = {
    id: entryID,
    actor_user_id: userID,
    actor_name: "Operator",
    target_type: "school",
    target_id: schoolID,
    target_name: "Portland State University",
    created_at: createdAt,
  };
  const catalogState = {
    slug: "portland-state-university",
    is_active: true,
    deleted_at: null,
  };

  assert.deepEqual(
    auditLogPageSchema.parse({
      audit_entries: [
        {
          ...entry,
          action: "school.updated",
          before: { ...catalogState, updated_at: "2026-10-12T22:14:00Z" },
          after: { ...catalogState, updated_at: "2026-10-12T22:15:00Z" },
          metadata: {
            operator_reason: "Use the common short name",
            edited_fields: ["short_name"],
          },
        },
        {
          ...entry,
          action: "school_admin.revoked",
          before: { revoked_at: null, updated_at: "2026-10-12T22:14:00Z" },
          after: {
            revoked_at: "2026-10-12T22:15:00Z",
            updated_at: "2026-10-12T22:15:00Z",
          },
          metadata: { operator_reason: "Left the school" },
        },
      ],
      next_cursor: "",
      previous_cursor: "",
    }).audit_entries,
    [
      {
        ...entry,
        action: "school.updated",
        reason: "Use the common short name",
        changed_fields: ["short_name"],
      },
      {
        ...entry,
        action: "school_admin.revoked",
        reason: "Left the school",
        changed_fields: ["revoked_at"],
      },
    ],
  );
});
