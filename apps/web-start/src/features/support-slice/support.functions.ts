import { redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import {
  currentSessionRequest,
  isNativeFormPost,
  setPrivateNoStoreResponse
} from "../../server/request-boundary.server.js";
import {
  validateSupportTicketServerInput,
  type SupportTicketInput
} from "./contracts.js";
import { submitSupportTicketOperation } from "./support-operations.server.js";

export const submitSupportTicket = createServerFn({
  method: "POST",
  strict: { input: false }
})
  .validator((input: SupportTicketInput | FormData) =>
    validateSupportTicketServerInput(input)
  )
  .handler(async ({ data }) => {
    setPrivateNoStoreResponse();
    const nativeForm = isNativeFormPost();
    if (!data.valid) {
      if (nativeForm) nativeRedirect("/support?support=failed");
      return {
        status: "error" as const,
        message: data.message,
        fieldErrors: data.fieldErrors
      };
    }

    const request = currentSessionRequest();
    const result = await submitSupportTicketOperation(data.value, {
      api: request.api,
      cookieHeader: request.cookieHeader
    });
    if (nativeForm) {
      nativeRedirect(
        `/support?support=${result.status === "success" ? "submitted" : "failed"}`
      );
    }
    return result;
  });

function nativeRedirect(href: string): never {
  throw redirect({ href, statusCode: 303 });
}
