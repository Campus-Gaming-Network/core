import { createFileRoute } from "@tanstack/react-router";
import { getNavigationSessionOperation } from "../features/event-slice/auth-operations.server";
import { methodNotAllowedResponse } from "../server/health.server";
import { sessionRequestForHeaders } from "../server/request-boundary.server";

export const Route = createFileRoute("/api/navigation-session")({
  server: {
    handlers: {
      GET: ({ request }) => navigationSessionResponse(request),
      HEAD: ({ request }) => navigationSessionResponse(request),
      POST: methodNotAllowedResponse,
      PUT: methodNotAllowedResponse,
      PATCH: methodNotAllowedResponse,
      DELETE: methodNotAllowedResponse,
      OPTIONS: methodNotAllowedResponse
    }
  }
});

async function navigationSessionResponse(request: Request): Promise<Response> {
  const sessionRequest = sessionRequestForHeaders(request.headers);
  const session = await getNavigationSessionOperation({
    api: sessionRequest.api,
    cookieHeader: sessionRequest.cookieHeader,
    sessionCookieValue: sessionRequest.sessionCookieValue
  });

  return Response.json(session, {
    headers: { "cache-control": "private, no-store" }
  });
}
