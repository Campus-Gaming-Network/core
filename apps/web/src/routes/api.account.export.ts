import { createFileRoute } from "@tanstack/react-router";
import { dataExportResponse } from "../features/account-slice/data-export.server";
import { validatedPublicOrigin } from "../server/environment.server";
import { methodNotAllowedResponse } from "../server/health.server";
import { sessionRequestForHeaders } from "../server/request-boundary.server";

export const Route = createFileRoute("/api/account/export")({
  server: {
    handlers: {
      POST: ({ request }) => {
        const session = sessionRequestForHeaders(request.headers);
        return dataExportResponse(request, {
          api: session.api,
          cookieHeader: session.cookieHeader,
          publicOrigin: validatedPublicOrigin(),
        });
      },
      GET: methodNotAllowedResponse,
      HEAD: methodNotAllowedResponse,
      PUT: methodNotAllowedResponse,
      PATCH: methodNotAllowedResponse,
      DELETE: methodNotAllowedResponse,
      OPTIONS: methodNotAllowedResponse,
    },
  },
});
