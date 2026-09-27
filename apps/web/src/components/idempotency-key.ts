import { useHydrated } from "@tanstack/react-router";
import { useState } from "react";

/**
 * Returns a random version 4 UUID. It uses getRandomValues because
 * crypto.randomUUID is unavailable on plain-HTTP development hosts, which are
 * not secure contexts.
 */
export function newIdempotencyKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Identifies one submission of a create form, so a doubled or retried request
 * returns the record the first request created instead of adding another.
 *
 * The server-rendered key survives hydration, so a native submit before
 * hydration and an enhanced submit after it share one key. A form mounted by
 * client navigation starts with a fresh key instead, because cached loader
 * data may hold a key an earlier submission already used. Forms that stay
 * mounted after a success call `rotate` before the next submission.
 */
export function useIdempotencyKey(renderedKey: string) {
  const hydrated = useHydrated();
  const [key, setKey] = useState(() =>
    hydrated ? newIdempotencyKey() : renderedKey,
  );
  return { key, rotate: () => setKey(newIdempotencyKey()) };
}
