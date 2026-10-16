import { useBlocker } from "@tanstack/react-router";
import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { ConfirmDialog } from "./confirm-dialog";
import {
  isDirty,
  shouldConfirmLeave,
  snapshotForm,
  type FormSnapshot,
} from "./unsaved-changes-state";

const interactions = ["pointerdown", "keydown", "focusin"];

/**
 * Guards a long form against losing typed work. Attach `formRef` to the
 * `<form>` and render `dialog` next to it (not inside it). Once the form
 * differs from the values it loaded with, in-app navigation asks to confirm
 * and closing or reloading the tab shows the browser's own prompt.
 *
 * A submit in flight never prompts: the enhanced mutation marks the form
 * `aria-busy` until its redirect finishes, and a native submit is detected by
 * its unprevented submit event. Without JavaScript none of this runs.
 */
export function useUnsavedChangesGuard(): {
  formRef: RefObject<HTMLFormElement | null>;
  dialog: ReactNode;
} {
  const formRef = useRef<HTMLFormElement>(null);
  const initialRef = useRef<FormSnapshot | null>(null);
  const nativeSubmitRef = useRef(false);
  const returnFocusRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    // Child components set their hidden inputs in their own effects, which
    // run before this one, so the baseline already includes them.
    initialRef.current = snapshotForm(form);

    // Custom controls fill in their value after hydration (the school, say),
    // so the baseline is taken again just before the first interaction.
    const rebase = () => {
      initialRef.current = snapshotForm(form);
      for (const type of interactions)
        form.removeEventListener(type, rebase, true);
    };
    for (const type of interactions) form.addEventListener(type, rebase, true);

    // React's submit handler runs first; if it did not prevent the default,
    // the browser is submitting the form natively and will unload the page.
    const onSubmit = (event: Event) => {
      if (event.target === form && !event.defaultPrevented) {
        nativeSubmitRef.current = true;
      }
    };
    document.addEventListener("submit", onSubmit);

    // A save that stays on this page (the profile) ends with the busy mark
    // removed and no error summary; what is typed is then the saved state.
    const observer = new MutationObserver(() => {
      if (form.hasAttribute("aria-busy")) return;
      requestAnimationFrame(() => {
        if (!form.querySelector(".form-error-summary")) {
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
      for (const type of interactions)
        form.removeEventListener(type, rebase, true);
      observer.disconnect();
    };
  }, []);

  // Compared when asked, not on each keystroke, so changes made by custom
  // controls that only rewrite a hidden input are seen too.
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

  const blocker = useBlocker({
    shouldBlockFn: ({ current, next }) =>
      shouldConfirmLeave({
        dirty: dirty(),
        submitting: submitting(),
        currentPathname: current.pathname,
        nextPathname: next.pathname,
      }),
    enableBeforeUnload: () => dirty() && !submitting(),
    withResolver: true,
  });

  const dialog =
    blocker.status === "blocked" ? (
      <form
        method="dialog"
        onSubmit={(event) => {
          event.preventDefault();
          blocker.proceed();
        }}
      >
        <ConfirmDialog
          cancelLabel="Keep editing"
          confirmLabel="Leave"
          heading="Leave without saving?"
          onClose={() => blocker.reset()}
          open
          returnFocusRef={returnFocusRef}
        >
          <p>
            You have changes that have not been saved. Leaving discards them.
          </p>
        </ConfirmDialog>
      </form>
    ) : null;

  return { formRef, dialog };
}
