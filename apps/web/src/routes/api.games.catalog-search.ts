import { createFileRoute } from "@tanstack/react-router";
import { defaultErrorReporter } from "../features/school-slice/catalog-operations.server";
import { catalogGameSearchApiResponse } from "../features/game-picker/game-filter.server";
import { methodNotAllowedResponse } from "../server/health.server";
import { goBFFForHeaders } from "../server/request-boundary.server";

export const Route = createFileRoute("/api/games/catalog-search")({
  server: {
    handlers: {
      GET: ({ request }) =>
        catalogGameSearchApiResponse(request, {
          api: goBFFForHeaders(request.headers),
          reportError: defaultErrorReporter,
        }),
      POST: methodNotAllowedResponse,
      PUT: methodNotAllowedResponse,
      PATCH: methodNotAllowedResponse,
      DELETE: methodNotAllowedResponse,
      OPTIONS: methodNotAllowedResponse,
    },
  },
});
