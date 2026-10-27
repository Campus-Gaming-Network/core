// What a stubbed fetch was called with, read the way the code under test
// passed it, so assertions compare the exact text it sent.

export function requestURL(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

/** The request's body, which the code under test always sends as text. */
export function bodyText(init: RequestInit | undefined): string {
  const body = init?.body;
  if (typeof body !== "string") {
    throw new TypeError(`expected a text request body, got ${typeof body}`);
  }
  return body;
}
