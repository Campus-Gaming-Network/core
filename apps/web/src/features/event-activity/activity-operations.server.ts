import {
  ApiContractError,
  ApiError,
  type ApiClient,
} from "../../server/api.server.js";
import {
  eventActivityResponseDtoSchema,
  type EventActivityInput,
  type EventActivityResult,
} from "./contracts.js";

type Dependencies = {
  api: ApiClient;
  cookieHeader: string;
  unlockHeaders?: HeadersInit;
  reportError?: (error: unknown) => void;
};

/**
 * A page of the event's activity log as the viewer may see it. The API
 * filters the entries; a missing, locked, or long-cancelled event is not
 * found, and any other failure is unavailable.
 */
export async function eventActivityOperation(
  { slug, limit, after }: EventActivityInput,
  {
    api,
    cookieHeader,
    unlockHeaders,
    reportError = defaultErrorReporter,
  }: Dependencies,
): Promise<EventActivityResult> {
  const query = new URLSearchParams({ limit: String(limit) });
  if (after) query.set("after", after);
  try {
    const { data } = await api({
      path: `/events/${encodeURIComponent(slug)}/activity?${query}`,
      cookieHeader,
      headers: unlockHeaders,
      cache: "no-store",
      responseSchema: eventActivityResponseDtoSchema,
    });
    return { status: "found", page: data };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return { status: "not_found" };
    }
    reportError(error);
    return { status: "unavailable" };
  }
}

function defaultErrorReporter(error: unknown): void {
  if (error instanceof ApiContractError) {
    console.error("Event activity response contract violation", {
      path: error.path,
      issues: error.issues,
    });
  } else if (!(error instanceof ApiError)) {
    console.error("Event activity request failed");
  }
}
