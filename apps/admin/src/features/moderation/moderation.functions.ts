import { redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import {
  currentAdminRequest,
  isNativeFormPost,
} from "../../server/admin-request.server.js";
import {
  moderationDetailInputSchema,
  queueBrowseInputSchema,
  validateQueueMutationServerInput,
  type QueueMutationInput,
} from "./contracts.js";
import {
  getReportDetailOperation,
  getReportQueueOperation,
  getSupportDetailOperation,
  getSupportQueueOperation,
  updateQueueItemOperation,
} from "./moderation-operations.server.js";

export const getReportQueue = createServerFn({ method: "GET" })
  .validator(queueBrowseInputSchema)
  .handler(async ({ data }) => {
    const request = currentAdminRequest(false);
    return getReportQueueOperation(data, request);
  });

export const getSupportQueue = createServerFn({ method: "GET" })
  .validator(queueBrowseInputSchema)
  .handler(async ({ data }) => {
    const request = currentAdminRequest(false);
    return getSupportQueueOperation(data, request);
  });

export const getReportDetail = createServerFn({ method: "GET" })
  .validator(moderationDetailInputSchema)
  .handler(async ({ data }) => {
    const request = currentAdminRequest(false);
    return getReportDetailOperation(data, request);
  });

export const getSupportDetail = createServerFn({ method: "GET" })
  .validator(moderationDetailInputSchema)
  .handler(async ({ data }) => {
    const request = currentAdminRequest(false);
    return getSupportDetailOperation(data, request);
  });

export const updateQueueItem = createServerFn({
  method: "POST",
  strict: { input: false },
})
  .validator((input: QueueMutationInput | FormData) =>
    validateQueueMutationServerInput(input),
  )
  .handler(async ({ data }) => {
    const nativeForm = isNativeFormPost();
    if (!data.valid) {
      if (nativeForm) {
        throw redirect({
          href: moderationDestination(data.kind, data.id, "update-failed"),
          statusCode: 303,
        });
      }
      return {
        status: "error" as const,
        message: data.message,
        fieldErrors: data.fieldErrors,
      };
    }

    const result = await updateQueueItemOperation(
      data.value,
      currentAdminRequest(true),
    );
    if (nativeForm) {
      throw redirect({
        href:
          result.status === "success"
            ? result.redirectTo
            : moderationDestination(
                data.value.kind,
                data.value.id,
                result.status === "conflict" ? "conflict" : "update-failed",
              ),
        statusCode: 303,
      });
    }
    return result;
  });

function moderationDestination(
  kind: string,
  id: string,
  notice: "update-failed" | "conflict",
): string {
  const collection = kind === "support-ticket" ? "support-tickets" : "reports";
  const safeID = /^[0-9a-f-]{36}$/i.test(id) ? id : "invalid";
  return `/${collection}/${encodeURIComponent(safeID)}?notice=${notice}`;
}
