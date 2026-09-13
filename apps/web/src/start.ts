import {
  createCsrfMiddleware,
  createMiddleware,
  createStart
} from "@tanstack/react-start";

const localSiteOrigin = "http://localhost:3000";

const csrfMiddleware = createCsrfMiddleware({
  filter: ({ handlerType }) => handlerType === "serverFn",
  origin: publicOrigin()
});

const securityHeadersMiddleware = createMiddleware().server(
  async ({ next, request }) => {
    const result = await next();
    const response = result.response;
    const headers = new Headers(response.headers);
    const defaults = {
      "content-security-policy":
        "frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
      "permissions-policy":
        "camera=(), microphone=(), geolocation=(), payment=()",
      "referrer-policy": "strict-origin-when-cross-origin",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY"
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
        "max-age=31536000; includeSubDomains"
      );
    }

    return {
      ...result,
      response: new Response(response.body, {
        headers,
        status: response.status,
        statusText: response.statusText
      })
    };
  }
);

export const startInstance = createStart(() => ({
  requestMiddleware: [securityHeadersMiddleware, csrfMiddleware]
}));

function publicOrigin(): string {
  if (typeof window !== "undefined") {
    return window.location.origin;
  }

  // The production server entry validates this value before it imports the
  // application handler. URL parsing here normalizes an allowed trailing slash
  // to the exact Origin header representation expected by CSRF middleware.
  return new URL(process.env.SITE_URL?.trim() || localSiteOrigin).origin;
}
