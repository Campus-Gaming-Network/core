import { createFileRoute } from "@tanstack/react-router";
import { analyticsEventResponse } from "../server/analytics.server";
import { validatedPublicOrigin } from "../server/environment.server";
import { methodNotAllowedResponse } from "../server/health.server";

export const Route = createFileRoute("/insights/event")({
  server: {
    handlers: {
      POST: ({ request }) =>
        analyticsEventResponse(request, {
          siteOrigin: validatedPublicOrigin(),
        }),
      GET: methodNotAllowedResponse,
      HEAD: methodNotAllowedResponse,
      PUT: methodNotAllowedResponse,
      PATCH: methodNotAllowedResponse,
      DELETE: methodNotAllowedResponse,
      OPTIONS: methodNotAllowedResponse,
    },
  },
});
