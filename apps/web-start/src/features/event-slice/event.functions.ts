import { redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import {
  applyCookieMutation,
  currentSessionRequest,
  eventUnlockHeaders,
  goBFFForCurrentRequest,
  isNativeFormPost,
  setPrivateNoStoreResponse
} from "../../server/request-boundary.server.js";
import {
  cancelEventOperation,
  createEventOperation,
  editEventPageOperation,
  eventInterestOperation,
  getEventDetailOperation,
  getEventsBrowseOperation,
  newEventPageOperation,
  reportEventOperation,
  rsvpEventOperation,
  updateEventOperation,
  unlockEventOperation
} from "./event-operations.server.js";
import {
  eventFormPageInputSchema,
  eventsBrowseInputSchema,
  eventSlugInputSchema,
  validateCancelEventServerInput,
  validateCreateEventServerInput,
  validateEventInterestServerInput,
  validateReportEventServerInput,
  validateRSVPServerInput,
  validateUpdateEventServerInput,
  validateUnlockServerInput,
  type CreateEventInput,
  type EventInterestInput,
  type EventSlugInput,
  type ReportEventInput,
  type RSVPEventInput,
  type UpdateEventInput,
  type UnlockEventInput
} from "./contracts.js";

export const getEventsBrowse = createServerFn({ method: "GET" })
  .validator(eventsBrowseInputSchema)
  .handler(async ({ data }) =>
    getEventsBrowseOperation(data, { api: goBFFForCurrentRequest() })
  );

export const getEventDetail = createServerFn({ method: "GET" })
  .validator(eventSlugInputSchema)
  .handler(async ({ data }) => {
    const request = currentSessionRequest();
    setPrivateNoStoreResponse();

    return getEventDetailOperation(data, {
      api: request.api,
      cookieHeader: request.cookieHeader,
      unlockHeaders: eventUnlockHeaders(data.slug)
    });
  });

export const getNewEventPage = createServerFn({ method: "GET" })
  .validator(eventFormPageInputSchema)
  .handler(async ({ data }) => {
    const request = currentSessionRequest();
    setPrivateNoStoreResponse();
    return newEventPageOperation(data, {
      api: request.api,
      cookieHeader: request.cookieHeader,
      sessionCookieValue: request.sessionCookieValue
    });
  });

export const getEditEventPage = createServerFn({ method: "GET" })
  .validator(
    eventSlugInputSchema.extend({
      schoolQuery: eventFormPageInputSchema.shape.schoolQuery
    })
  )
  .handler(async ({ data }) => {
    const request = currentSessionRequest();
    setPrivateNoStoreResponse();
    return editEventPageOperation(data, {
      api: request.api,
      cookieHeader: request.cookieHeader,
      sessionCookieValue: request.sessionCookieValue,
      unlockHeaders: eventUnlockHeaders(data.slug)
    });
  });

export const createEvent = createServerFn({
  method: "POST",
  strict: { input: false }
})
  .validator((input: CreateEventInput | FormData) =>
    validateCreateEventServerInput(input)
  )
  .handler(async ({ data }) => {
    setPrivateNoStoreResponse();
    const nativeForm = isNativeFormPost();
    if (!data.valid) {
      if (nativeForm) {
        throw redirect({ href: "/events/new?event=failed", statusCode: 303 });
      }
      return {
        status: "error" as const,
        message: data.message,
        fieldErrors: data.fieldErrors
      };
    }

    const request = currentSessionRequest();
    const result = await createEventOperation(data.value, {
      api: request.api,
      cookieHeader: request.cookieHeader
    });
    if (nativeForm) {
      throw redirect({
        href: result.status === "success"
          ? result.redirectTo
          : "/events/new?event=failed",
        statusCode: 303
      });
    }
    return result;
  });

export const updateEvent = createServerFn({
  method: "POST",
  strict: { input: false }
})
  .validator((input: UpdateEventInput | FormData) =>
    validateUpdateEventServerInput(input)
  )
  .handler(async ({ data }) => {
    setPrivateNoStoreResponse();
    const nativeForm = isNativeFormPost();
    if (!data.valid) {
      if (nativeForm) {
        throw redirect({
          href: data.slug
            ? `/events/${encodeURIComponent(data.slug)}/edit?event=failed`
            : "/events?event=failed",
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
    const result = await updateEventOperation(data.value, {
      api: request.api,
      cookieHeader: request.cookieHeader
    });
    if (nativeForm) {
      throw redirect({
        href: result.status === "success"
          ? result.redirectTo
          : `/events/${encodeURIComponent(data.value.slug)}/edit?event=failed`,
        statusCode: 303
      });
    }
    return result;
  });

export const reportEvent = createServerFn({
  method: "POST",
  strict: { input: false }
})
  .validator((input: ReportEventInput | FormData) =>
    validateReportEventServerInput(input)
  )
  .handler(async ({ data }) => {
    setPrivateNoStoreResponse();
    const nativeForm = isNativeFormPost();
    if (!data.valid) {
      if (nativeForm) {
        throw redirect({
          href: reportEventDestination(data.slug, "report-failed"),
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
    const result = await reportEventOperation(data.value, {
      api: request.api,
      cookieHeader: request.cookieHeader
    });
    if (nativeForm) {
      throw redirect({
        href: reportEventDestination(
          data.value.slug,
          result.status === "success" ? "report-submitted" : "report-failed"
        ),
        statusCode: 303
      });
    }
    return result;
  });

export const cancelEvent = createServerFn({
  method: "POST",
  strict: { input: false }
})
  .validator((input: EventSlugInput | FormData) =>
    validateCancelEventServerInput(input)
  )
  .handler(async ({ data }) => {
    setPrivateNoStoreResponse();
    const nativeForm = isNativeFormPost();
    let result = { redirectTo: "/events?event=cancel-failed" };
    if (data.valid) {
      const request = currentSessionRequest();
      result = await cancelEventOperation(data.value, {
        api: request.api,
        cookieHeader: request.cookieHeader
      });
    }

    if (nativeForm) {
      throw redirect({ href: result.redirectTo, statusCode: 303 });
    }
    return { status: "success" as const, redirectTo: result.redirectTo };
  });

export const setEventInterest = createServerFn({
  method: "POST",
  strict: { input: false }
})
  .validator((input: EventInterestInput | FormData) =>
    validateEventInterestServerInput(input)
  )
  .handler(async ({ data }) => {
    setPrivateNoStoreResponse();
    const nativeForm = isNativeFormPost();
    let result = { redirectTo: "/events?event=interest-failed" };
    if (data.valid) {
      const request = currentSessionRequest();
      result = await eventInterestOperation(data.value, {
        api: request.api,
        cookieHeader: request.cookieHeader,
        unlockHeaders: eventUnlockHeaders(data.value.slug)
      });
    }

    if (nativeForm) {
      throw redirect({ href: result.redirectTo, statusCode: 303 });
    }
    return { status: "success" as const, redirectTo: result.redirectTo };
  });

export const unlockEvent = createServerFn({
  method: "POST",
  strict: { input: false }
})
  .validator((input: UnlockEventInput | FormData) =>
    validateUnlockServerInput(input)
  )
  .handler(async ({ data }) => {
    setPrivateNoStoreResponse();
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
        message: data.message,
        fieldErrors: data.fieldErrors
      };
    }

    const result = await unlockEventOperation(data.value, {
      api: goBFFForCurrentRequest(),
      production: process.env.NODE_ENV === "production",
      applyCookie: applyCookieMutation
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
    setPrivateNoStoreResponse();
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
        message: data.message,
        fieldErrors: data.fieldErrors
      };
    }

    const request = currentSessionRequest();
    const result = await rsvpEventOperation(data.value, {
      api: request.api,
      cookieHeader: request.cookieHeader,
      unlockHeaders: eventUnlockHeaders(data.value.slug)
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

function eventFailureDestination(
  slug: string | undefined,
  notice: "unlock-failed" | "rsvp-failed"
): string {
  return slug
    ? `/events/${encodeURIComponent(slug)}?event=${notice}`
    : `/events?event=${notice}`;
}

function reportEventDestination(
  slug: string | undefined,
  notice: "report-failed" | "report-submitted"
): string {
  return slug
    ? `/events/${encodeURIComponent(slug)}?event=${notice}`
    : `/events?event=${notice}`;
}
