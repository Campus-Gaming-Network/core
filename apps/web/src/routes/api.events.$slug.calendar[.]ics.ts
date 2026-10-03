import { createFileRoute } from "@tanstack/react-router";
import { eventCalendarResponse } from "../features/event-slice/event-calendar.server";
import { validatedPublicOrigin } from "../server/environment.server";
import { methodNotAllowedResponse } from "../server/health.server";
import { goBFFForHeaders } from "../server/request-boundary.server";

export const Route = createFileRoute("/api/events/$slug/calendar.ics")({
  server: {
    handlers: {
      GET: ({ request, params }) => handleCalendarRequest(request, params.slug),
      HEAD: ({ request, params }) =>
        handleCalendarRequest(request, params.slug),
      POST: methodNotAllowedResponse,
      PUT: methodNotAllowedResponse,
      PATCH: methodNotAllowedResponse,
      DELETE: methodNotAllowedResponse,
      OPTIONS: methodNotAllowedResponse,
    },
  },
});

function handleCalendarRequest(
  request: Request,
  slug: string,
): Promise<Response> {
  return eventCalendarResponse(request, slug, {
    api: goBFFForHeaders(request.headers),
    publicOrigin: validatedPublicOrigin(),
  });
}
