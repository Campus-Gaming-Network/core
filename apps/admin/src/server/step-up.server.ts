import { safeReturnPath } from "../features/catalog/contracts.js";
import { setCookieHeader, type CookieMutation } from "./cookies.server.js";
import { adminEnvironment } from "./environment.server.js";
import {
  createSessionDependencies,
  stepUpAdminSession,
} from "./session.server.js";

/**
 * Completes a step-up posted to `/step-up`. Cloudflare Access applies a
 * short reauthentication policy to that path, so this request carries a fresh
 * Access assertion. The Go API verifies that it is newer than the session's
 * and rotates both admin cookies. Server routes bypass the server-function
 * CSRF middleware, so this handler applies the same rule: a browser's
 * Sec-Fetch-Site must be same-origin, or, without it, Origin must match
 * exactly. Pages send no referrer, so browsers report form posts' Origin as
 * "null"; Sec-Fetch-Site is the reliable signal.
 */
export async function completeStepUp(request: Request): Promise<Response> {
  const environment = adminEnvironment();
  const fetchSite = request.headers.get("sec-fetch-site");
  const sameOrigin =
    fetchSite !== null
      ? fetchSite === "same-origin"
      : request.headers.get("origin") === environment.siteOrigin;
  if (!sameOrigin) {
    return new Response(null, {
      status: 403,
      headers: { "cache-control": "private, no-store" },
    });
  }

  const form = await request.formData().catch(() => undefined);
  const returnPath = safeReturnPath(form?.get("return"));
  const cookies = new Map(
    (request.headers.get("cookie") ?? "")
      .split(";")
      .map((part) => part.trim().split("="))
      .filter(([name, value]) => name && value !== undefined)
      .map(([name, ...value]) => [name, value.join("=")]),
  );
  const mutations: CookieMutation[] = [];
  const result = await stepUpAdminSession({
    ...createSessionDependencies(environment),
    assertion: request.headers.get("Cf-Access-Jwt-Assertion") ?? "",
    sessionCookieValue: cookies.get(environment.sessionCookieName),
    csrfCookieValue: cookies.get(environment.csrfCookieName),
    applyCookies: (next) => mutations.push(...next),
  });

  const headers = new Headers({
    "cache-control": "private, no-store",
    location:
      result.status === "authenticated"
        ? `${returnPath}${returnPath.includes("?") ? "&" : "?"}notice=stepped-up`
        : `/step-up?return=${encodeURIComponent(returnPath)}&error=failed`,
  });
  for (const mutation of mutations) {
    headers.append("set-cookie", setCookieHeader(mutation));
  }
  return new Response(null, { status: 303, headers });
}
