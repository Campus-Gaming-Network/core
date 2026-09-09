import { createFileRoute } from "@tanstack/react-router";
import { getNavigationSessionOperation } from "../features/event-slice/auth-operations.server";
import { createApiClient } from "../server/api.server";
import { sessionCookieName } from "../server/cookies.server";
import { methodNotAllowedResponse } from "../server/health.server";

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
  const cookieHeader = request.headers.get("cookie") ?? "";
  const configuredSessionCookie = sessionCookieName();
  const session = await getNavigationSessionOperation({
    api: createApiClient({ incomingHeaders: request.headers }),
    cookieHeader,
    sessionCookieValue: cookieValue(cookieHeader, configuredSessionCookie)
  });

  return Response.json(session, {
    headers: { "cache-control": "private, no-store" }
  });
}

function cookieValue(cookieHeader: string, name: string): string | undefined {
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) {
      continue;
    }

    return part.slice(separator + 1).trim() || undefined;
  }

  return undefined;
}
