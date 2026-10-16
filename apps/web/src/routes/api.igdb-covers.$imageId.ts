import { createFileRoute } from "@tanstack/react-router";
import { searchResultCoverResponse } from "../server/game-cover.server";
import { methodNotAllowedResponse } from "../server/health.server";

export const Route = createFileRoute("/api/igdb-covers/$imageId")({
  server: {
    handlers: {
      GET: ({ request, params }) =>
        searchResultCoverResponse(request, params.imageId),
      HEAD: ({ request, params }) =>
        searchResultCoverResponse(request, params.imageId),
      POST: methodNotAllowedResponse,
      PUT: methodNotAllowedResponse,
      PATCH: methodNotAllowedResponse,
      DELETE: methodNotAllowedResponse,
      OPTIONS: methodNotAllowedResponse,
    },
  },
});
