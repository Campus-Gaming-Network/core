import { useEffect, type RefObject } from "react";

/**
 * Sets a field's custom validity so a scripted submit stops at the first
 * problem. Without JavaScript this never runs and the server is the only
 * check.
 */
export function useCustomValidity(
  ref: RefObject<HTMLInputElement | HTMLSelectElement | null>,
  message: string | null | undefined,
) {
  useEffect(() => {
    ref.current?.setCustomValidity(message ?? "");
  }, [ref, message]);
}
