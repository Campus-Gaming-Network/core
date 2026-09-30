import {
  getRequestHeaders,
  setResponseHeader,
} from "@tanstack/react-start/server";
import { withAccessIdentity } from "./api.server.js";
import { adminCookieHeader } from "./cookies.server.js";
import { adminEnvironment } from "./environment.server.js";
import { currentCookie } from "./issued-cookies.server.js";
import { createSessionDependencies } from "./session.server.js";

/**
 * Builds the Admin API request context for the current browser request. Only
 * the isolated admin cookies are forwarded; mutations also carry the exact
 * site origin and the session's CSRF value. Every call also carries the Access
 * identity verified for this request, which the API checks against the one the
 * session was issued to.
 */
export function currentAdminRequest(mutation: boolean) {
  setResponseHeader("cache-control", "private, no-store");
  setResponseHeader("vary", "Cookie");
  const environment = adminEnvironment();
  const dependencies = createSessionDependencies(environment);
  const sessionCookie = currentCookie(environment.sessionCookieName);
  const csrfCookie = currentCookie(environment.csrfCookieName);
  const headers = new Headers();
  if (mutation) {
    headers.set("Origin", environment.siteOrigin);
    headers.set("X-CGN-Admin-CSRF", csrfCookie ?? "");
  }

  const assertion = getRequestHeaders().get("Cf-Access-Jwt-Assertion") ?? "";
  return {
    api: withAccessIdentity(dependencies.api, () =>
      dependencies.validateAssertion(assertion),
    ),
    cookieHeader: adminCookieHeader(
      environment.sessionCookieName,
      sessionCookie,
      mutation ? environment.csrfCookieName : undefined,
      mutation ? csrfCookie : undefined,
    ),
    headers,
  };
}

export function isNativeFormPost(): boolean {
  const headers = getRequestHeaders();
  if (headers.get("x-tsr-serverfn") === "true") return false;
  const contentType = headers.get("content-type") ?? "";
  return (
    contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("multipart/form-data")
  );
}
