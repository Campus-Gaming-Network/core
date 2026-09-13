import {
  deleteCookie,
  getCookie,
  getRequestHeaders,
  setCookie,
  setResponseHeader
} from "@tanstack/react-start/server";
import { type ApiClient } from "./api.server.js";
import { createGoBFFClient } from "./bff.server.js";
import {
  cookieHeaderValue,
  eventUnlockCookieName,
  sessionCookieName,
  type CookieMutation
} from "./cookies.server.js";
import {
  optionalViewerProfile,
  requiredViewerProfile,
  type ProfileDTO,
  type ViewerRequest
} from "./viewer.server.js";

type HeaderReader = Pick<Headers, "get">;

export type SessionRequest = ViewerRequest & {
  sessionCookieName: string;
};

export function goBFFForHeaders(incomingHeaders: HeaderReader): ApiClient {
  return createGoBFFClient({ incomingHeaders });
}

export function goBFFForCurrentRequest(): ApiClient {
  return goBFFForHeaders(getRequestHeaders());
}

export function incomingCookieHeader(
  incomingHeaders: HeaderReader = getRequestHeaders()
): string {
  return incomingHeaders.get("cookie") ?? "";
}

export function sessionRequestForHeaders(
  incomingHeaders: HeaderReader
): SessionRequest {
  const configuredCookieName = sessionCookieName();
  const incomingCookies = incomingCookieHeader(incomingHeaders);
  const sessionCookieValue = cookieHeaderValue(
    incomingCookies,
    configuredCookieName
  );

  return {
    api: goBFFForHeaders(incomingHeaders),
    cookieHeader: sessionOnlyCookieHeader(
      configuredCookieName,
      sessionCookieValue
    ),
    sessionCookieName: configuredCookieName,
    sessionCookieValue
  };
}

export function currentSessionRequest(): SessionRequest {
  const incomingHeaders = getRequestHeaders();
  const configuredCookieName = sessionCookieName();
  const sessionCookieValue = getCookie(configuredCookieName);

  return {
    api: goBFFForHeaders(incomingHeaders),
    cookieHeader: sessionOnlyCookieHeader(
      configuredCookieName,
      sessionCookieValue
    ),
    sessionCookieName: configuredCookieName,
    sessionCookieValue
  };
}

export function sessionOnlyCookieHeader(
  name: string,
  value: string | undefined
): string {
  return value ? `${name}=${value}` : "";
}

export async function optionalCurrentProfile(): Promise<ProfileDTO | null> {
  return optionalViewerProfile(currentSessionRequest());
}

export async function requiredCurrentProfile(): Promise<ProfileDTO> {
  return requiredViewerProfile(currentSessionRequest());
}

export function eventUnlockHeaders(slug: string): HeadersInit | undefined {
  const token = getCookie(eventUnlockCookieName(slug));
  return token ? { "X-CGN-Event-Unlock": token } : undefined;
}

export function applyCookieMutation(mutation: CookieMutation): void {
  if (mutation.kind === "delete") {
    deleteCookie(mutation.name, mutation.options);
  } else {
    setCookie(mutation.name, mutation.value, mutation.options);
  }
}

export function isNativeFormPost(): boolean {
  return isNativeFormRequest(getRequestHeaders());
}

export function isNativeFormRequest(headers: HeaderReader): boolean {
  if (headers.get("x-tsr-serverfn") === "true") {
    return false;
  }

  const contentType = headers.get("content-type") ?? "";
  return contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("multipart/form-data");
}

export function setPrivateNoStoreResponse(): void {
  setResponseHeader("cache-control", "private, no-store");
}

export function setViewerResponseCache(hasSessionCookie: boolean): void {
  setResponseHeader("vary", "Cookie");
  setResponseHeader(
    "cache-control",
    hasSessionCookie
      ? "private, no-store"
      : "public, max-age=0, must-revalidate"
  );
}
