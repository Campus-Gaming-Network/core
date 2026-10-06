import { createFileRoute } from "@tanstack/react-router";
import { gameSearchApiResponse } from "../features/game-picker/game-search-api.server";
import { methodNotAllowedResponse } from "../server/health.server";
import { sessionRequestForHeaders } from "../server/request-boundary.server";

export const Route = createFileRoute("/api/games/igdb-search")({
  server: {
    handlers: {
      GET: ({ request }) =>
        gameSearchApiResponse(
          request,
          sessionRequestForHeaders(request.headers),
        ),
      POST: methodNotAllowedResponse,
      PUT: methodNotAllowedResponse,
      PATCH: methodNotAllowedResponse,
      DELETE: methodNotAllowedResponse,
      OPTIONS: methodNotAllowedResponse,
    },
  },
});
