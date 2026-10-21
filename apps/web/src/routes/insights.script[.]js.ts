import { createFileRoute } from "@tanstack/react-router";
import { analyticsScriptResponse } from "../server/analytics.server";
import { methodNotAllowedResponse } from "../server/health.server";

export const Route = createFileRoute("/insights/script.js")({
  server: {
    handlers: {
      GET: () => analyticsScriptResponse(),
      HEAD: () => analyticsScriptResponse(),
      POST: methodNotAllowedResponse,
      PUT: methodNotAllowedResponse,
      PATCH: methodNotAllowedResponse,
      DELETE: methodNotAllowedResponse,
      OPTIONS: methodNotAllowedResponse,
    },
  },
});
