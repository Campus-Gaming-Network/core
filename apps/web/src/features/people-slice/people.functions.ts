import { createServerFn } from "@tanstack/react-start";
import {
  currentSessionRequest,
  eventUnlockHeaders,
  setPrivateNoStoreResponse,
} from "../../server/request-boundary.server.js";
import {
  eventAttendeesInputSchema,
  schoolMembersInputSchema,
  teamMembersInputSchema,
} from "./contracts.js";
import {
  eventAttendeesOperation,
  schoolMembersOperation,
  teamMembersOperation,
} from "./people-operations.server.js";

// Lists belong to the viewer's session, so the responses are never cached. A
// request without a session sets nothing: it never reaches the API, and the
// public page around it keeps its own cache policy.

export const getEventAttendees = createServerFn({ method: "GET" })
  .validator(eventAttendeesInputSchema)
  .handler(async ({ data }) => {
    const request = currentSessionRequest();
    if (request.sessionCookieValue) setPrivateNoStoreResponse();

    return eventAttendeesOperation(data, {
      api: request.api,
      cookieHeader: request.cookieHeader,
      unlockHeaders: eventUnlockHeaders(data.slug),
    });
  });

export const getSchoolMembers = createServerFn({ method: "GET" })
  .validator(schoolMembersInputSchema)
  .handler(async ({ data }) => {
    const request = currentSessionRequest();
    if (request.sessionCookieValue) setPrivateNoStoreResponse();

    return schoolMembersOperation(data, {
      api: request.api,
      cookieHeader: request.cookieHeader,
    });
  });

export const getTeamMembers = createServerFn({ method: "GET" })
  .validator(teamMembersInputSchema)
  .handler(async ({ data }) => {
    const request = currentSessionRequest();
    if (request.sessionCookieValue) setPrivateNoStoreResponse();

    return teamMembersOperation(data, {
      api: request.api,
      cookieHeader: request.cookieHeader,
    });
  });
