import { redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import {
  currentSessionRequest,
  isNativeFormPost,
  setPrivateNoStoreResponse,
  setViewerResponseCache
} from "../../server/request-boundary.server.js";
import {
  publicProfileInputSchema,
  reportUserNativeDestination,
  validateReportUserServerInput,
  type ReportUserInput
} from "./contracts.js";
import {
  getPublicProfilePageOperation,
  reportUserOperation
} from "./public-profile-operations.server.js";

export const getPublicProfilePage = createServerFn({ method: "GET" })
  .validator(publicProfileInputSchema)
  .handler(async ({ data }) => {
    const request = currentSessionRequest();
    const hasSessionCookie = Boolean(request.sessionCookieValue);
    setViewerResponseCache(hasSessionCookie);

    const result = await getPublicProfilePageOperation(data, {
      api: request.api,
      cookieHeader: request.cookieHeader,
      sessionCookieValue: request.sessionCookieValue
    });

    return { ...result, hasSessionCookie };
  });

export const reportUser = createServerFn({
  method: "POST",
  strict: { input: false }
})
  .validator((input: ReportUserInput | FormData) =>
    validateReportUserServerInput(input)
  )
  .handler(async ({ data }) => {
    setPrivateNoStoreResponse();
    const nativeForm = isNativeFormPost();
    if (!data.valid) {
      if (nativeForm) {
        throw redirect({
          href: reportUserNativeDestination(data.userID, "failed"),
          statusCode: 303
        });
      }
      return {
        status: "error" as const,
        message: data.message,
        fieldErrors: data.fieldErrors
      };
    }

    const request = currentSessionRequest();
    const result = await reportUserOperation(data.value, {
      api: request.api,
      cookieHeader: request.cookieHeader
    });
    if (nativeForm) {
      throw redirect({
        href: reportUserNativeDestination(
          data.value.userID,
          result.status === "success" ? "submitted" : "failed"
        ),
        statusCode: 303
      });
    }
    return result;
  });
