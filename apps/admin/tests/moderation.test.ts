import assert from "node:assert/strict";
import test from "node:test";
import type { ApiClient } from "../src/server/api.server.js";
import {
  reportsPageSchema,
  supportTicketsPageSchema,
  validateModerationDetailSearch,
  validateQueueMutationServerInput,
  validateQueueSearch,
} from "../src/features/moderation/contracts.js";
import {
  getReportQueueOperation,
  updateQueueItemOperation,
} from "../src/features/moderation/moderation-operations.server.js";
import { AdminApiError } from "../src/server/api.server.js";

const reportID = "11111111-1111-4111-8111-111111111111";
const reporterID = "22222222-2222-4222-8222-222222222222";
const targetID = "33333333-3333-4333-8333-333333333333";
const assigneeID = "44444444-4444-4444-8444-444444444444";
const createdAt = "2026-09-18T16:00:00Z";
const updatedAt = "2026-09-18T16:05:00Z";

const report = {
  id: reportID,
  reporter_user_id: reporterID,
  target_type: "user",
  target_id: targetID,
  reason: '<img src=x onerror="alert(1)">',
  status: "open" as const,
  resolution_note: "",
  retention_started_at: null,
  created_at: createdAt,
  updated_at: updatedAt,
};

test("queue contracts strip detail-only moderation text", () => {
  const parsedReports = reportsPageSchema.parse({
    reports: [{ ...report, contact_email: "private@example.test" }],
    next_cursor: "",
    previous_cursor: "",
  });

  assert.deepEqual(parsedReports, {
    reports: [
      {
        id: reportID,
        reporter_user_id: reporterID,
        target_type: "user",
        target_id: targetID,
        status: "open",
        retention_started_at: null,
        created_at: createdAt,
        updated_at: updatedAt,
      },
    ],
    next_cursor: "",
    previous_cursor: "",
  });

  const parsedTickets = supportTicketsPageSchema.parse({
    support_tickets: [
      {
        id: reportID,
        submitter_user_id: reporterID,
        subject: "Account help",
        status: "open",
        retention_started_at: null,
        created_at: createdAt,
        updated_at: updatedAt,
        contact_email: "private@example.test",
        name: "Private name",
        message: "Private message",
        resolution_note: "Private note",
      },
    ],
    next_cursor: "",
    previous_cursor: "",
  });
  assert.deepEqual(parsedTickets, {
    support_tickets: [
      {
        id: reportID,
        submitter_user_id: reporterID,
        subject: "Account help",
        status: "open",
        retention_started_at: null,
        created_at: createdAt,
        updated_at: updatedAt,
      },
    ],
    next_cursor: "",
    previous_cursor: "",
  });
});

test("moderation search validation rejects mixed cursors and unknown filters", () => {
  assert.deepEqual(
    validateQueueSearch({
      status: "open",
      assignee: "unassigned",
      after: "after-cursor",
      before: "before-cursor",
    }),
    {},
  );
  assert.deepEqual(validateQueueSearch({ status: "pending" }), {});
  assert.deepEqual(
    validateModerationDetailSearch({
      audit_after: "after-cursor",
      notice: "conflict",
    }),
    { audit_after: "after-cursor", notice: "conflict" },
  );
});

test("native and enhanced queue mutation inputs share one validator", () => {
  const form = new FormData();
  form.set("kind", "report");
  form.set("id", reportID);
  form.set("expected_updated_at", updatedAt);
  form.set("status", "in_review");
  form.set("assigned_to_user_id", assigneeID);
  form.set("resolution_note", "Investigating");

  const fromForm = validateQueueMutationServerInput(form);
  const fromObject = validateQueueMutationServerInput({
    kind: "report",
    id: reportID,
    expected_updated_at: updatedAt,
    status: "in_review",
    assigned_to_user_id: assigneeID,
    resolution_note: "Investigating",
  });

  assert.deepEqual(fromForm, fromObject);
});

test("report queue reads use bounded filters and isolated cookies", async () => {
  let received:
    | { path: string; cookieHeader?: string; method?: string }
    | undefined;
  const api = (async (options) => {
    received = options;
    return {
      data: { reports: [], next_cursor: "", previous_cursor: "" },
      response: Response.json({}),
    };
  }) as ApiClient;

  const result = await getReportQueueOperation(
    { status: "open", assignee: "unassigned", after: "opaque cursor" },
    { api, cookieHeader: "admin_session=opaque" },
  );

  assert.deepEqual(result, {
    reports: [],
    next_cursor: "",
    previous_cursor: "",
  });
  assert.deepEqual(received, {
    path: "/admin/v1/reports?limit=25&status=open&assignee=unassigned&after=opaque+cursor",
    cookieHeader: "admin_session=opaque",
    responseSchema: reportsPageSchema,
  });
});

test("stale updates return current state while preserving submitted form data", async () => {
  const calls: Array<{ method?: string; body?: unknown }> = [];
  const api = (async (options) => {
    calls.push({ method: options.method, body: options.body });
    if (options.method === "PATCH") {
      throw new AdminApiError(409, "queue_item_conflict");
    }
    return {
      data: { ...report, status: "in_review", updated_at: createdAt },
      response: Response.json({}),
    };
  }) as ApiClient;
  const input = {
    kind: "report" as const,
    id: reportID,
    expected_updated_at: updatedAt,
    status: "closed" as const,
    assigned_to_user_id: assigneeID,
    resolution_note: "Keep this operator input",
  };

  const result = await updateQueueItemOperation(input, {
    api,
    cookieHeader: "admin_session=opaque; admin_csrf=csrf",
    headers: { Origin: "https://admin.example.test" },
  });

  assert.deepEqual(result, {
    status: "conflict",
    message:
      "This item changed after you opened it. Your entries are still in the form. Review the current state, then submit again.",
    current: { ...report, status: "in_review", updated_at: createdAt },
  });
  assert.deepEqual(calls, [
    {
      method: "PATCH",
      body: {
        expected_updated_at: updatedAt,
        status: "closed",
        assigned_to_user_id: assigneeID,
        resolution_note: "Keep this operator input",
      },
    },
    { method: undefined, body: undefined },
  ]);
});
