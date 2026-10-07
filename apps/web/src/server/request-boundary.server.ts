import {
  deleteCookie,
  getCookie,
  getRequest,
  getRequestHeaders,
  setCookie,
  setResponseHeader,
} from "@tanstack/react-start/server";
import { type ApiClient, type Fetcher } from "./api.server.js";
import { createGoBFFClient } from "./bff.server.js";
import {
  cookieHeaderValue,
  eventUnlockCookieName,
  sessionCookieName,
  type CookieMutation,
} from "./cookies.server.js";
import {
  optionalViewerProfile,
  requiredViewerProfile,
  type ProfileDTO,
  type ViewerRequest,
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
  incomingHeaders: HeaderReader = getRequestHeaders(),
): string {
  return incomingHeaders.get("cookie") ?? "";
}

export function sessionRequestForHeaders(
  incomingHeaders: HeaderReader,
): SessionRequest {
  const configuredCookieName = sessionCookieName();
  const incomingCookies = incomingCookieHeader(incomingHeaders);
  const sessionCookieValue = cookieHeaderValue(
    incomingCookies,
    configuredCookieName,
  );

  return {
    api: goBFFForHeaders(incomingHeaders),
    cookieHeader: sessionOnlyCookieHeader(
      configuredCookieName,
      sessionCookieValue,
    ),
    sessionCookieName: configuredCookieName,
    sessionCookieValue,
  };
}

// While one document renders, the root route reads `/me` for the header and
// the page's loader reads it for itself. They share one upstream read per
// incoming request and session cookie. A write to `/me` drops the shared read.
const profileReads = new WeakMap<Request, Map<string, Promise<Response>>>();

function profileSharingFetcher(request: Request): Fetcher {
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (!url.pathname.endsWith("/me")) return fetch(input, init);

    const reads = profileReads.get(request) ?? new Map();
    profileReads.set(request, reads);
    const cookie = new Headers(init?.headers).get("cookie") ?? "";
    if ((init?.method ?? "GET") !== "GET") {
      reads.delete(cookie);
      return fetch(input, init);
    }

    const read = reads.get(cookie) ?? fetch(input, init);
    reads.set(cookie, read);
    return (await read).clone();
  };
}

export function currentSessionRequest(): SessionRequest {
  const incomingHeaders = getRequestHeaders();
  const configuredCookieName = sessionCookieName();
  const sessionCookieValue = getCookie(configuredCookieName);

  return {
    api: createGoBFFClient({
      incomingHeaders,
      fetcher: profileSharingFetcher(getRequest()),
    }),
    cookieHeader: sessionOnlyCookieHeader(
      configuredCookieName,
      sessionCookieValue,
    ),
    sessionCookieName: configuredCookieName,
    sessionCookieValue,
  };
}

export function sessionOnlyCookieHeader(
  name: string,
  value: string | undefined,
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
  return (
    contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("multipart/form-data")
  );
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
      : "public, max-age=0, must-revalidate",
  );
}
