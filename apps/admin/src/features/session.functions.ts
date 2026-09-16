import { redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import {
  deleteCookie,
  getCookie,
  getRequestHeaders,
  setCookie,
  setResponseHeader
} from "@tanstack/react-start/server";
import type { CookieMutation } from "../server/cookies.server.js";
import { adminEnvironment } from "../server/environment.server.js";
import {
  createSessionDependencies,
  establishAdminSession,
  logoutAdminSession
} from "../server/session.server.js";

export const getAdminShellSession = createServerFn({ method: "GET" }).handler(
  async () => {
    setResponseHeader("cache-control", "private, no-store");
    setResponseHeader("vary", "Cookie");
    const environment = adminEnvironment();
    const dependencies = createSessionDependencies(environment);
    return establishAdminSession({
      ...dependencies,
      assertion: getRequestHeaders().get("Cf-Access-Jwt-Assertion") ?? "",
      sessionCookieValue: getCookie(environment.sessionCookieName),
      applyCookies
    });
  }
);

export const logout = createServerFn({ method: "POST" }).handler(async () => {
  setResponseHeader("cache-control", "private, no-store");
  const environment = adminEnvironment();
  const dependencies = createSessionDependencies(environment);
  await logoutAdminSession({
    api: dependencies.api,
    siteOrigin: dependencies.siteOrigin,
    sessionCookieName: dependencies.sessionCookieName,
    sessionCookieValue: getCookie(dependencies.sessionCookieName),
    csrfCookieName: dependencies.csrfCookieName,
    csrfCookieValue: getCookie(dependencies.csrfCookieName),
    applyCookies
  });

  if (getRequestHeaders().get("x-tsr-serverfn") !== "true") {
    throw redirect({ href: "/", statusCode: 303 });
  }
  return { status: "success" as const };
});

function applyCookies(mutations: CookieMutation[]): void {
  for (const mutation of mutations) {
    if (mutation.kind === "delete") {
      deleteCookie(mutation.name, mutation.options);
    } else {
      setCookie(mutation.name, mutation.value, mutation.options);
    }
  }
}
