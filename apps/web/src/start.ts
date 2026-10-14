import {
  createCsrfMiddleware,
  createMiddleware,
  createStart,
} from "@tanstack/react-start";
import {
  errorMonitoringConnectSource,
  reportServerError,
} from "./server/error-monitor.server.js";
import { sessionEndedFetch } from "./session-ended.js";

const localSiteOrigin = "http://localhost:3000";

const csrfMiddleware = createCsrfMiddleware({
  filter: ({ handlerType }) => handlerType === "serverFn",
  origin: publicOrigin(),
});

// Outermost, so it sees a failure from a server route or from any middleware
// below it.
const errorReportingMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    reportServerError(error);
    throw error;
  }
});

const functionErrorReportingMiddleware = createMiddleware({
  type: "function",
}).server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    reportServerError(error);
    throw error;
  }
});

// In the browser, every server function call goes through a fetch that
// notices when the server has ended the session.
const sessionEndedMiddleware = createMiddleware({ type: "function" }).client(
  ({ next }) => next({ fetch: sessionEndedFetch }),
);

const securityHeadersMiddleware = createMiddleware().server(
  async ({ next, request }) => {
    const { withRequestNonce } =
      await import("./server/request-nonce.server.js");
    return withRequestNonce(async (nonce) => {
      const result = await next();
      const response = result.response;
      const headers = new Headers(response.headers);
      const defaults = {
        // Inline scripts run only with this request's nonce, so injected
        // markup cannot execute. There is no `unsafe-eval`. Game covers are
        // proxied through the site, so images need no IGDB origin.
        "content-security-policy": `default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src ${imageSources()}; font-src 'self'; connect-src ${connectSources()}; style-src 'self' 'unsafe-inline'; script-src 'self' 'nonce-${nonce}'`,
        "cross-origin-opener-policy": "same-origin",
        "permissions-policy":
          "camera=(), microphone=(), geolocation=(), payment=()",
        "referrer-policy": "strict-origin-when-cross-origin",
        "x-content-type-options": "nosniff",
        "x-frame-options": "DENY",
      } as const;

      for (const [name, value] of Object.entries(defaults)) {
        if (!headers.has(name)) headers.set(name, value);
      }
      if (
        process.env.DEPLOYMENT_ENV === "production" &&
        new URL(request.url).protocol === "https:"
      ) {
        headers.set(
          "strict-transport-security",
          "max-age=31536000; includeSubDomains",
        );
      }

      return {
        ...result,
        response: new Response(response.body, {
          headers,
          status: response.status,
          statusText: response.statusText,
        }),
      };
    });
  },
);

export const startInstance = createStart(() => ({
  functionMiddleware: [
    sessionEndedMiddleware,
    functionErrorReportingMiddleware,
  ],
  requestMiddleware: [
    errorReportingMiddleware,
    securityHeadersMiddleware,
    csrfMiddleware,
  ],
}));

// School logos load from our local bundle or the separate admin asset origin.
function imageSources(): string {
  const base = process.env.R2_PUBLIC_ASSET_ORIGIN?.trim();
  if (!base) return "'self' data:";
  try {
    const { origin, protocol } = new URL(base);
    return protocol === "https:" || protocol === "http:"
      ? `'self' data: ${origin}`
      : "'self' data:";
  } catch {
    return "'self' data:";
  }
}

function connectSources(): string {
  const errorMonitoring = errorMonitoringConnectSource();
  return errorMonitoring ? `'self' ${errorMonitoring}` : "'self'";
}

function publicOrigin(): string {
  if (typeof window !== "undefined") {
    return window.location.origin;
  }

  // The production server entry validates this value before it imports the
  // application handler. URL parsing here normalizes an allowed trailing slash
  // to the exact Origin header representation expected by CSRF middleware.
  return new URL(process.env.SITE_URL?.trim() || localSiteOrigin).origin;
}
