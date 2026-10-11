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
