import { useRouterState } from "@tanstack/react-router";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { shouldFocusSearchShortcut } from "./directory-results-keys";

/** Fast responses finish inside this window, so they never show the pending state. */
const pendingDelayMs = 200;

const searchFieldSelector =
  'form input[type="search"], form input[role="combobox"], form input[type="text"]';

/**
 * Pending, pagination and keyboard behavior for a directory's results.
 * `busy` turns true when the router has been loading for a moment (a filter
 * change or a page link). After a page link finishes loading, the results
 * scroll into view and take focus. Pressing "/" outside a text field focuses
 * the directory's first search field.
 */
export function useDirectoryResults(): {
  busy: boolean;
  onPaginate: () => void;
  resultsRef: RefObject<HTMLDivElement | null>;
} {
  const loading = useRouterState({ select: (state) => state.isLoading });
  const [busy, setBusy] = useState(false);
  const resultsRef = useRef<HTMLDivElement>(null);
  const paginating = useRef(false);

  useEffect(() => {
    if (!loading) {
      setBusy(false);
      return;
    }
    const timer = window.setTimeout(() => setBusy(true), pendingDelayMs);
    return () => window.clearTimeout(timer);
  }, [loading]);

  useEffect(() => {
    if (loading || !paginating.current) return;
    paginating.current = false;
    const results = resultsRef.current;
    if (!results) return;
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    results.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "start",
    });
    results.focus({ preventScroll: true });
  }, [loading]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target;
      if (
        !shouldFocusSearchShortcut({
          key: event.key,
          modified: event.ctrlKey || event.metaKey || event.altKey,
          targetTag: target instanceof HTMLElement ? target.tagName : "",
          targetType:
            target instanceof HTMLInputElement ? target.type : undefined,
          editable: target instanceof HTMLElement && target.isContentEditable,
        })
      )
        return;
      const field =
        document.querySelector<HTMLInputElement>(searchFieldSelector);
      if (!field) return;
      event.preventDefault();
      field.focus();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const onPaginate = useCallback(() => {
    paginating.current = true;
  }, []);

  return { busy, onPaginate, resultsRef };
}

/**
 * The results region. It is the focus target after paging, and marks itself
 * busy (and softens) while the next results load.
 */
export function DirectoryResults({
  busy,
  children,
  label,
  resultsRef,
}: {
  busy: boolean;
  children: ReactNode;
  label: string;
  resultsRef: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div
      aria-busy={busy}
      aria-label={label}
      className="directory-results"
      data-busy={busy ? "true" : undefined}
      ref={resultsRef}
      role="region"
      tabIndex={-1}
    >
      {children}
    </div>
  );
}
