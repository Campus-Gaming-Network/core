import {
  createCsrfMiddleware,
  createMiddleware,
  createStart,
} from "@tanstack/react-start";

const localAdminOrigin = "http://localhost:3002";

const csrfMiddleware = createCsrfMiddleware({
  filter: ({ handlerType }) => handlerType === "serverFn",
  origin: adminOrigin(),
});

const securityHeadersMiddleware = createMiddleware().server(
  async ({ next, request }) => {
    const result = await next();
    const response = result.response;
    const headers = new Headers(response.headers);
    const defaults = {
      "cache-control": "private, no-store",
      "content-security-policy": `default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src ${imageSources()}; font-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'`,
      "permissions-policy":
        "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "x-robots-tag": "noindex, nofollow, noarchive, nosnippet",
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
  requestMiddleware: [securityHeadersMiddleware, csrfMiddleware],
}));

// School-logo previews load from the separate asset origin, and nowhere else.
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

function adminOrigin(): string {
  if (typeof window !== "undefined") return window.location.origin;
  return new URL(process.env.ADMIN_SITE_URL?.trim() || localAdminOrigin).origin;
}
