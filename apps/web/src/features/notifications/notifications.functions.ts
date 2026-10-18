import { redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import {
  currentSessionRequest,
  isNativeFormPost,
  setPrivateNoStoreResponse,
} from "../../server/request-boundary.server.js";
import {
  validateInboxSearch,
  validateMarkReadInput,
  type InboxMutationResult,
} from "./contracts.js";
import {
  inboxOperation,
  markAllReadOperation,
  markReadOperation,
} from "./notifications-operations.server.js";

export const getInbox = createServerFn({ method: "GET" })
  .validator((input: { after?: string }) => validateInboxSearch(input))
  .handler(async ({ data }) => {
    const request = currentSessionRequest();
    setPrivateNoStoreResponse();
    if (!request.sessionCookieValue) {
      return { status: "unauthenticated" as const };
    }
    return inboxOperation({ after: data.after }, request);
  });

export const markNotificationRead = createServerFn({
  method: "POST",
  strict: { input: false },
})
  .validator((input: object | FormData) => validateMarkReadInput(input))
  .handler(async ({ data }) => {
    setPrivateNoStoreResponse();
    const result: InboxMutationResult = data
      ? await markReadOperation(data, currentSessionRequest())
      : { status: "success", redirectTo: "/notifications?notice=failed" };
    return finish(result);
  });

export const markAllNotificationsRead = createServerFn({
  method: "POST",
}).handler(async () => {
  setPrivateNoStoreResponse();
  return finish(await markAllReadOperation(currentSessionRequest()));
});

// A native form post redirects; an enhanced one returns where to go.
function finish(result: InboxMutationResult): InboxMutationResult {
  if (isNativeFormPost()) {
    throw redirect({ href: result.redirectTo, statusCode: 303 });
  }
  return result;
}
