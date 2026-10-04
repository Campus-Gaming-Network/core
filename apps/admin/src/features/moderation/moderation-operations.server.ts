import {
  AdminApiContractError,
  AdminApiError,
  type ApiClient,
} from "../../server/api.server.js";
import { siteGrantsPageSchema } from "../catalog/contracts.js";
import {
  auditPageSchema,
  queueCountsSchema,
  rateLimitedMessage,
  reportSchema,
  reportsPageSchema,
  supportTicketSchema,
  supportTicketsPageSchema,
  type Operator,
  type QueueBrowseInput,
  type QueueMutationInput,
  type QueueMutationResult,
} from "./contracts.js";

type ReadDependencies = {
  api: ApiClient;
  cookieHeader: string;
};

type MutationDependencies = ReadDependencies & {
  headers: HeadersInit;
  reportError?: (error: unknown) => void;
};

/**
 * The active site admins, for picking an assignee by name. It is a convenience:
 * if the list cannot be read the queue still works, with nobody to pick.
 */
export async function getOperatorsOperation({
  api,
  cookieHeader,
}: ReadDependencies): Promise<Operator[]> {
  try {
    const { data } = await api({
      path: "/admin/v1/site-admin-grants?limit=100&state=active",
      cookieHeader,
      responseSchema: siteGrantsPageSchema,
    });
    return data.grants.map((grant) => ({
      id: grant.user_id,
      name: grant.user_name || "Unknown user",
    }));
  } catch (error) {
    if (error instanceof AdminApiError) return [];
    throw error;
  }
}

/** Counts of waiting work for each queue the operator may read. */
export async function getQueueCountsOperation(
  queues: { reports: boolean; support: boolean },
  { api, cookieHeader }: ReadDependencies,
) {
  const count = async (path: string) =>
    (await api({ path, cookieHeader, responseSchema: queueCountsSchema })).data;
  const [reports, support] = await Promise.all([
    queues.reports ? count("/admin/v1/report-counts") : undefined,
    queues.support ? count("/admin/v1/support-ticket-counts") : undefined,
  ]);
  return { reports, support };
}

export async function getReportQueueOperation(
  input: QueueBrowseInput,
  dependencies: ReadDependencies,
) {
  const query = queueQuery(input, true);
  const { data } = await dependencies.api({
    path: `/admin/v1/reports${query}`,
    cookieHeader: dependencies.cookieHeader,
    responseSchema: reportsPageSchema,
  });
  return data;
}

export async function getSupportQueueOperation(
  input: QueueBrowseInput,
  dependencies: ReadDependencies,
) {
  const query = queueQuery(input);
  const { data } = await dependencies.api({
    path: `/admin/v1/support-tickets${query}`,
    cookieHeader: dependencies.cookieHeader,
    responseSchema: supportTicketsPageSchema,
  });
  return data;
}

export async function getReportDetailOperation(
  input: { id: string; audit_after?: string; audit_before?: string },
  dependencies: ReadDependencies,
) {
  const encodedID = encodeURIComponent(input.id);
  const auditQuery = auditCursorQuery(input);
  const [report, audit] = await Promise.all([
    dependencies.api({
      path: `/admin/v1/reports/${encodedID}`,
      cookieHeader: dependencies.cookieHeader,
      responseSchema: reportSchema,
    }),
    dependencies.api({
      path: `/admin/v1/reports/${encodedID}/audit${auditQuery}`,
      cookieHeader: dependencies.cookieHeader,
      responseSchema: auditPageSchema,
    }),
  ]);
  return { report: report.data, audit: audit.data };
}

export async function getSupportDetailOperation(
  input: { id: string; audit_after?: string; audit_before?: string },
  dependencies: ReadDependencies,
) {
  const encodedID = encodeURIComponent(input.id);
  const auditQuery = auditCursorQuery(input);
  const [ticket, audit] = await Promise.all([
    dependencies.api({
      path: `/admin/v1/support-tickets/${encodedID}`,
      cookieHeader: dependencies.cookieHeader,
      responseSchema: supportTicketSchema,
    }),
    dependencies.api({
      path: `/admin/v1/support-tickets/${encodedID}/audit${auditQuery}`,
      cookieHeader: dependencies.cookieHeader,
      responseSchema: auditPageSchema,
    }),
  ]);
  return { ticket: ticket.data, audit: audit.data };
}

export async function updateQueueItemOperation(
  input: QueueMutationInput,
  {
    api,
    cookieHeader,
    headers,
    reportError = defaultErrorReporter,
  }: MutationDependencies,
): Promise<QueueMutationResult> {
  const collection = input.kind === "report" ? "reports" : "support-tickets";
  const schema = input.kind === "report" ? reportSchema : supportTicketSchema;
  const path = `/admin/v1/${collection}/${encodeURIComponent(input.id)}`;

  try {
    await api({
      path,
      method: "PATCH",
      body: {
        expected_updated_at: input.expected_updated_at,
        status: input.status,
        assigned_to_user_id: input.assigned_to_user_id,
        resolution_note: input.resolution_note,
      },
      cookieHeader,
      headers,
      responseSchema: schema,
    });
    return {
      status: "success",
      redirectTo: `/${collection}/${encodeURIComponent(input.id)}?notice=updated`,
    };
  } catch (error) {
    if (
      error instanceof AdminApiError &&
      error.status === 409 &&
      error.code === "queue_item_conflict"
    ) {
      try {
        const { data: current } = await api({
          path,
          cookieHeader,
          responseSchema: schema,
        });
        return {
          status: "conflict",
          message:
            "This item changed after you opened it. Your entries are still in the form. Review the current state, then submit again.",
          current,
        };
      } catch (readError) {
        reportError(readError);
        return {
          status: "error",
          message:
            "This item changed, but its current state could not be loaded. Reload the page before trying again.",
        };
      }
    }
    if (
      error instanceof AdminApiError &&
      error.status === 409 &&
      error.code === "queue_no_changes"
    ) {
      return {
        status: "error",
        message: "Change at least one field before saving.",
      };
    }
    if (error instanceof AdminApiError && error.status === 400) {
      return {
        status: "error",
        message: "Check the submitted values and try again.",
      };
    }
    if (error instanceof AdminApiError && error.status === 429) {
      return { status: "error", message: rateLimitedMessage };
    }

    reportError(error);
    return {
      status: "error",
      message: "The update could not be saved. Try again.",
    };
  }
}

function queueQuery(input: QueueBrowseInput, reports = false): string {
  const query = new URLSearchParams({ limit: "25" });
  if (input.status && input.status !== "all") {
    query.set("status", input.status);
  }
  if (reports && input.type) query.set("target_type", input.type);
  if (input.assignee) query.set("assignee", input.assignee);
  if (input.user) query.set("user", input.user);
  if (input.after) query.set("after", input.after);
  if (input.before) query.set("before", input.before);
  return `?${query.toString()}`;
}

function auditCursorQuery(input: {
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
    console.error("Admin moderation request failed");
  }
}
