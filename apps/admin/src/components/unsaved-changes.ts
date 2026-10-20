import { useBlocker } from "@tanstack/react-router";
import { useEffect, useRef, type RefObject } from "react";
import {
  isDirty,
  shouldConfirmLeave,
  snapshotForm,
  type FormSnapshot,
} from "./unsaved-changes-state";

/**
 * Guards an admin form against losing typed work. Attach `formRef` to the
 * `<form>`. Once the form differs from the values it loaded with, in-app
 * navigation asks to confirm and closing or reloading the tab shows the
 * browser's own prompt.
 *
 * A submit in flight never prompts: the enhanced mutation marks the form
 * `aria-busy` until its redirect finishes, and a native submit is detected by
 * its unprevented submit event. Without JavaScript none of this runs.
 */
export function useUnsavedChangesGuard(): {
  formRef: RefObject<HTMLFormElement | null>;
} {
  const formRef = useRef<HTMLFormElement>(null);
  const initialRef = useRef<FormSnapshot | null>(null);
  const nativeSubmitRef = useRef(false);

  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    initialRef.current = snapshotForm(form);

    // React's submit handler runs first; if it did not prevent the default,
    // the browser is submitting the form natively and will unload the page.
    const onSubmit = (event: Event) => {
      if (event.target === form && !event.defaultPrevented) {
        nativeSubmitRef.current = true;
      }
    };
    document.addEventListener("submit", onSubmit);

    // A save that stays on this page ends with the busy mark removed and no
    // error shown; what is typed is then the saved state.
    const observer = new MutationObserver(() => {
      if (form.hasAttribute("aria-busy")) return;
      requestAnimationFrame(() => {
        if (!form.querySelector("[data-form-feedback]")) {
          initialRef.current = snapshotForm(form);
        }
      });
    });
    observer.observe(form, {
      attributes: true,
      attributeFilter: ["aria-busy"],
    });
    return () => {
      document.removeEventListener("submit", onSubmit);
      observer.disconnect();
    };
  }, []);

  const dirty = () => {
    const form = formRef.current;
    return Boolean(
      form &&
      initialRef.current &&
      isDirty(initialRef.current, snapshotForm(form)),
    );
  };

  const submitting = () =>
    nativeSubmitRef.current ||
    formRef.current?.getAttribute("aria-busy") === "true";

  useBlocker({
    shouldBlockFn: ({ current, next }) =>
      shouldConfirmLeave({
        dirty: dirty(),
        submitting: submitting(),
        currentPathname: current.pathname,
        nextPathname: next.pathname,
      })
        ? !window.confirm(
            "You have changes that have not been saved. Leave without saving?",
          )
        : false,
    enableBeforeUnload: () => dirty() && !submitting(),
  });

  return { formRef };
}

/**
 * After a failed save, moves focus to the first invalid field in `form`, or
 * to the error summary when no field is marked, so keyboard and screen-reader
 * users land on the problem.
 */
export function focusFormError(form: HTMLFormElement | null) {
  const target =
    form?.querySelector<HTMLElement>('[aria-invalid="true"]') ??
    form?.querySelector<HTMLElement>("[data-form-feedback]");
  target?.focus();
}
