import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";

const requestNonce = new AsyncLocalStorage<string>();

/**
 * Runs one request with a fresh CSP nonce. Everything the request starts,
 * including server rendering, sees the same nonce, so the framework's inline
 * scripts carry the value the response header allows and nothing else does.
 */
export function withRequestNonce<T>(run: (nonce: string) => T): T {
  const nonce = randomBytes(16).toString("base64");
  return requestNonce.run(nonce, () => run(nonce));
}

/** The nonce of the request being served, if any. */
export function currentRequestNonce(): string | undefined {
  return requestNonce.getStore();
}
