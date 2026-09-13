import {
  ApiContractError,
  ApiError,
  type ApiClient
} from "../../server/api.server.js";
import {
  supportTicketIdDtoSchema,
  type SupportTicketInput,
  type SupportTicketResult
} from "./contracts.js";

type Dependencies = {
  api: ApiClient;
  cookieHeader: string;
  reportError?: (error: unknown) => void;
};

export async function submitSupportTicketOperation(
  input: SupportTicketInput,
  {
    api,
    cookieHeader,
    reportError = defaultErrorReporter
  }: Dependencies
): Promise<SupportTicketResult> {
  try {
    await api({
      path: "/support-tickets",
      method: "POST",
      cookieHeader,
      body: input,
      responseSchema: supportTicketIdDtoSchema
    });
    return {
      status: "success",
      message: "Support ticket submitted. We will review it soon."
    };
  } catch (error) {
    reportError(error);
    return { status: "error", message: supportErrorMessage(error) };
  }
}

export function supportErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return "Something went wrong. Please try again.";
  }

  const messages: Record<string, string> = {
    database_unavailable: "The service is starting up. Try again in a moment.",
    invalid_request: "Check the form fields and try again.",
    rate_limited: "Too many attempts. Give it a minute, then try again.",
    support_ticket_failed:
      "We could not submit that support ticket. Please try again."
  };
  return messages[error.code] ?? "Something went wrong. Please try again.";
}

function defaultErrorReporter(error: unknown): void {
  if (error instanceof ApiContractError) {
    console.error("Support ticket response contract violation", {
      path: error.path,
      issues: error.issues
    });
  } else if (!(error instanceof ApiError)) {
    console.error("Support ticket request failed");
  }
}
