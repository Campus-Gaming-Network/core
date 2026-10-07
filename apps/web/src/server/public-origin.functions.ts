import { createServerFn } from "@tanstack/react-start";
import { getNavigationSessionOperation } from "../features/event-slice/auth-operations.server.js";
import { validatedPublicOrigin } from "./environment.server.js";
import { errorMonitoringConfig } from "./error-monitor.server.js";
import {
  currentSessionRequest,
  setPrivateNoStoreResponse,
} from "./request-boundary.server.js";

// One request serves every value because the root route asks on every
// navigation. The viewer is part of it so the header is right in the server
// HTML and after a login, a rename, or an expired session. A request with no
// session cookie makes no upstream call and stays publicly cacheable.
export const getPublicRuntimeConfig = createServerFn({ method: "GET" }).handler(
  async () => {
    const request = currentSessionRequest();
    const hasSessionCookie = Boolean(request.sessionCookieValue);
    // Only ever tightens the response: during server rendering this header
    // lands on the document, where a route may already have asked for private.
    if (hasSessionCookie) setPrivateNoStoreResponse();

    const session = await getNavigationSessionOperation({
      api: request.api,
      cookieHeader: request.cookieHeader,
      sessionCookieValue: request.sessionCookieValue,
    });

    return {
      errorMonitoring: errorMonitoringConfig(),
      hasSessionCookie,
      publicOrigin: validatedPublicOrigin(),
      viewer: session.authenticated ? session.user : null,
    };
  },
);
