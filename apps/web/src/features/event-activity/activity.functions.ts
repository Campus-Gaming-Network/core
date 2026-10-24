import { createServerFn } from "@tanstack/react-start";
import {
  currentSessionRequest,
  eventUnlockHeaders,
  setPrivateNoStoreResponse,
} from "../../server/request-boundary.server.js";
import { eventActivityOperation } from "./activity-operations.server.js";
import { eventActivityInputSchema } from "./contracts.js";

export const getEventActivity = createServerFn({ method: "GET" })
  .validator(eventActivityInputSchema)
  .handler(async ({ data }) => {
    // What a viewer sees depends on who they are.
    setPrivateNoStoreResponse();
    const request = currentSessionRequest();
    return eventActivityOperation(data, {
      api: request.api,
      cookieHeader: request.cookieHeader,
      unlockHeaders: eventUnlockHeaders(data.slug),
    });
  });
