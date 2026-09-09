import { createCsrfMiddleware, createStart } from "@tanstack/react-start";

const localSiteOrigin = "http://localhost:3100";

const csrfMiddleware = createCsrfMiddleware({
  filter: ({ handlerType }) => handlerType === "serverFn",
  origin: publicOrigin()
});

export const startInstance = createStart(() => ({
  requestMiddleware: [csrfMiddleware]
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
