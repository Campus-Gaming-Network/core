import { createFileRoute } from "@tanstack/react-router";
import { gameCoverResponse } from "../server/game-cover.server";
import { methodNotAllowedResponse } from "../server/health.server";

export const Route = createFileRoute("/api/games/$slug/cover")({
  server: {
    handlers: {
      GET: ({ request, params }) => gameCoverResponse(request, params.slug),
      HEAD: ({ request, params }) => gameCoverResponse(request, params.slug),
      POST: methodNotAllowedResponse,
      PUT: methodNotAllowedResponse,
      PATCH: methodNotAllowedResponse,
      DELETE: methodNotAllowedResponse,
      OPTIONS: methodNotAllowedResponse,
    },
  },
});
