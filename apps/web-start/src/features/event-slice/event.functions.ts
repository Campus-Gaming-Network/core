import { redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import {
  getCookie,
  getRequestHeader,
  getRequestHeaders,
  setCookie,
  setResponseHeader
} from "@tanstack/react-start/server";
import { createApiClient } from "../../server/api.server.js";
import {
  eventUnlockCookieName,
  type CookieMutation
} from "../../server/cookies.server.js";
import {
  getEventDetailOperation,
  rsvpEventOperation,
  unlockEventOperation
} from "./event-operations.server.js";
import {
  eventSlugInputSchema,
  validateRSVPServerInput,
  validateUnlockServerInput,
  type RSVPEventInput,
  type UnlockEventInput
} from "./contracts.js";

export const getEventDetail = createServerFn({ method: "GET" })
  .validator(eventSlugInputSchema)
  .handler(async ({ data }) => {
    const requestHeaders = getRequestHeaders();
    setResponseHeader("cache-control", "private, no-store");

    return getEventDetailOperation(data, {
      api: createApiClient({ incomingHeaders: requestHeaders }),
      cookieHeader: requestHeaders.get("cookie") ?? "",
      unlockToken: getCookie(eventUnlockCookieName(data.slug))
    });
  });

export const unlockEvent = createServerFn({
  method: "POST",
  strict: { input: false }
})
  .validator((input: UnlockEventInput | FormData) =>
    validateUnlockServerInput(input)
  )
  .handler(async ({ data }) => {
    const nativeForm = isNativeFormPost();
    if (!data.valid) {
      if (nativeForm) {
        throw redirect({
          href: eventFailureDestination(data.slug, "unlock-failed"),
          statusCode: 303
        });
      }
      return {
        status: "error" as const,
        message: "Check the form fields and try again."
      };
    }

    const result = await unlockEventOperation(data.value, {
      api: createApiClient({ incomingHeaders: getRequestHeaders() }),
      production: process.env.NODE_ENV === "production",
      applyCookie
    });

    if (nativeForm) {
      throw redirect({
        href: result.status === "success"
          ? result.redirectTo
          : eventFailureDestination(data.value.slug, "unlock-failed"),
        statusCode: 303
      });
    }
    return result;
  });

export const rsvpEvent = createServerFn({
  method: "POST",
  strict: { input: false }
})
  .validator((input: RSVPEventInput | FormData) => validateRSVPServerInput(input))
  .handler(async ({ data }) => {
    const nativeForm = isNativeFormPost();
    if (!data.valid) {
      if (nativeForm) {
        throw redirect({
          href: eventFailureDestination(data.slug, "rsvp-failed"),
          statusCode: 303
        });
      }
      return {
        status: "error" as const,
        message: "Check the form fields and try again."
      };
    }

    const requestHeaders = getRequestHeaders();
    const result = await rsvpEventOperation(data.value, {
      api: createApiClient({ incomingHeaders: requestHeaders }),
      cookieHeader: requestHeaders.get("cookie") ?? "",
      unlockToken: getCookie(eventUnlockCookieName(data.value.slug))
    });

    if (nativeForm) {
      throw redirect({
        href: result.status === "success"
          ? result.redirectTo
          : eventFailureDestination(data.value.slug, "rsvp-failed"),
        statusCode: 303
      });
    }
    return result;
  });

function applyCookie(mutation: CookieMutation): void {
  if (mutation.kind === "set") {
    setCookie(mutation.name, mutation.value, mutation.options);
  }
}

function isNativeFormPost(): boolean {
  const contentType = getRequestHeader("content-type") ?? "";
  return contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("multipart/form-data");
}

function eventFailureDestination(
  slug: string | undefined,
  notice: "unlock-failed" | "rsvp-failed"
): string {
  return slug
    ? `/events/${encodeURIComponent(slug)}?event=${notice}`
    : `/events?event=${notice}`;
}
