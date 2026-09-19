import { redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import {
  getCookie,
  getRequestHeaders,
  setResponseHeader,
} from "@tanstack/react-start/server";
import { adminCookieHeader } from "../../server/cookies.server.js";
import { adminEnvironment } from "../../server/environment.server.js";
import { createSessionDependencies } from "../../server/session.server.js";
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

function currentAdminRequest(mutation: boolean) {
  setResponseHeader("cache-control", "private, no-store");
  setResponseHeader("vary", "Cookie");
  const environment = adminEnvironment();
  const dependencies = createSessionDependencies(environment);
  const sessionCookie = getCookie(environment.sessionCookieName);
  const csrfCookie = getCookie(environment.csrfCookieName);
  const headers = new Headers();
  if (mutation) {
    headers.set("Origin", environment.siteOrigin);
    headers.set("X-CGN-Admin-CSRF", csrfCookie ?? "");
  }

  return {
    api: dependencies.api,
    cookieHeader: adminCookieHeader(
      environment.sessionCookieName,
      sessionCookie,
      mutation ? environment.csrfCookieName : undefined,
      mutation ? csrfCookie : undefined,
    ),
    headers,
  };
}

function isNativeFormPost(): boolean {
  const headers = getRequestHeaders();
  if (headers.get("x-tsr-serverfn") === "true") return false;
  const contentType = headers.get("content-type") ?? "";
  return (
    contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("multipart/form-data")
  );
}

function moderationDestination(
  kind: string,
  id: string,
  notice: "update-failed" | "conflict",
): string {
  const collection = kind === "support-ticket" ? "support-tickets" : "reports";
  const safeID = /^[0-9a-f-]{36}$/i.test(id) ? id : "invalid";
  return `/${collection}/${encodeURIComponent(safeID)}?notice=${notice}`;
}
