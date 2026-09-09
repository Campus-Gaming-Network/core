import * as z from "zod";
import {
  ApiContractError,
  ApiError,
  safeApiErrorMessage,
  type ApiClient
} from "../../server/api.server.js";
import {
  unlockCookieMutation,
  type CookieMutation
} from "../../server/cookies.server.js";
import {
  eventDetailDtoSchema,
  eventDtoSchema,
  type EventSlugInput,
  type GetEventDetailResult,
  type RSVPEventInput,
  type RSVPEventResult,
  type UnlockEventInput,
  type UnlockEventResult
} from "./contracts.js";

const unlockResponseSchema = z.object({
  event: eventDtoSchema,
  unlock_token: z.string().min(1),
  expires_at: z.iso.datetime({ offset: true })
});

type ReadDependencies = {
  api: ApiClient;
  cookieHeader: string;
  unlockToken?: string;
  reportError?: (error: unknown) => void;
};

type MutationDependencies = ReadDependencies & {
  production: boolean;
  applyCookie: (mutation: CookieMutation) => void;
};

export async function getEventDetailOperation(
  { slug }: EventSlugInput,
  {
    api,
    cookieHeader,
    unlockToken,
    reportError = defaultErrorReporter
  }: ReadDependencies
): Promise<GetEventDetailResult> {
  try {
    const { data } = await api({
      path: `/events/${encodeURIComponent(slug)}`,
      cookieHeader,
      headers: unlockToken ? { "X-CGN-Event-Unlock": unlockToken } : undefined,
      cache: "no-store",
      responseSchema: eventDetailDtoSchema
    });
    return { status: "found", event: data };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return { status: "not_found" };
    }
    reportError(error);
    return { status: "error", message: safeApiErrorMessage(error) };
  }
}

export async function unlockEventOperation(
  { slug, password }: UnlockEventInput,
  {
    api,
    production,
    applyCookie,
    reportError = defaultErrorReporter
  }: Pick<MutationDependencies, "api" | "production" | "applyCookie" | "reportError">
): Promise<UnlockEventResult> {
  try {
    const { data } = await api({
      path: `/events/${encodeURIComponent(slug)}/unlock`,
      method: "POST",
      body: { password },
      responseSchema: unlockResponseSchema
    });

    applyCookie(
      unlockCookieMutation(slug, data.unlock_token, data.expires_at, production)
    );

    return {
      status: "success",
      event: data.event,
      redirectTo: `/events/${encodeURIComponent(data.event.slug)}?event=unlocked`
    };
  } catch (error) {
    reportError(error);
    return { status: "error", message: safeApiErrorMessage(error) };
  }
}

export async function rsvpEventOperation(
  { slug, response }: RSVPEventInput,
  {
    api,
    cookieHeader,
    unlockToken,
    reportError = defaultErrorReporter
  }: ReadDependencies
): Promise<RSVPEventResult> {
  try {
    const { data } = await api({
      path: `/events/${encodeURIComponent(slug)}/rsvp`,
      method: "POST",
      cookieHeader,
      headers: unlockToken ? { "X-CGN-Event-Unlock": unlockToken } : undefined,
      body: { response },
      responseSchema: eventDtoSchema
    });

    return {
      status: "success",
      event: data,
      redirectTo: `/events/${encodeURIComponent(data.slug)}?event=rsvp-updated`
    };
  } catch (error) {
    reportError(error);
    return { status: "error", message: safeApiErrorMessage(error) };
  }
}

function defaultErrorReporter(error: unknown): void {
  if (error instanceof ApiContractError) {
    console.error("API response contract violation", {
      path: error.path,
      issues: error.issues
    });
  } else if (!(error instanceof ApiError)) {
    console.error("Event request failed");
  }
}
