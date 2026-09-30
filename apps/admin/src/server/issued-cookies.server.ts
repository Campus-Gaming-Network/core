import { getCookie, getRequest } from "@tanstack/react-start/server";
import type { CookieMutation } from "./cookies.server.js";

/**
 * Cookies this request has already set on its response. A first visit
 * establishes the admin session in the shell loader, and the page loaders that
 * run after it in the same request must use that session even though the
 * browser has not sent it back yet.
 */
const issuedByRequest = new WeakMap<Request, Map<string, string | undefined>>();

export function rememberIssuedCookies(mutations: CookieMutation[]): void {
  const request = getRequest();
  const issued = issuedByRequest.get(request) ?? new Map();
  for (const mutation of mutations) {
    issued.set(
      mutation.name,
      mutation.kind === "delete" ? undefined : mutation.value,
    );
  }
  issuedByRequest.set(request, issued);
}

/** The value the browser holds now: one set during this request, else sent. */
export function currentCookie(name: string): string | undefined {
  const issued = issuedByRequest.get(getRequest());
  return issued?.has(name) ? issued.get(name) : getCookie(name);
}
