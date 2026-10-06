import {
  createCsrfMiddleware,
  createMiddleware,
  createStart,
} from "@tanstack/react-start";
import { reportServerError } from "./server/error-monitor.server.js";

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

const securityHeadersMiddleware = createMiddleware().server(
  async ({ next, request }) => {
    const result = await next();
    const response = result.response;
    const headers = new Headers(response.headers);
    const defaults = {
      "content-security-policy": `frame-ancestors 'none'; base-uri 'self'; object-src 'none'; img-src ${imageSources()}`,
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
  },
);

export const startInstance = createStart(() => ({
  functionMiddleware: [functionErrorReportingMiddleware],
  requestMiddleware: [
    errorReportingMiddleware,
    securityHeadersMiddleware,
    csrfMiddleware,
  ],
}));

// School logos load from the separate asset origin, and images from nowhere
// else.
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

function publicOrigin(): string {
  if (typeof window !== "undefined") {
    return window.location.origin;
  }

  // The production server entry validates this value before it imports the
  // application handler. URL parsing here normalizes an allowed trailing slash
  // to the exact Origin header representation expected by CSRF middleware.
  return new URL(process.env.SITE_URL?.trim() || localSiteOrigin).origin;
}
