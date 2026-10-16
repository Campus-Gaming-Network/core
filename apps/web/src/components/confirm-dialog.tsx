import {
  useEffect,
  useId,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";

export function ConfirmDialog({
  cancelLabel = "Keep it",
  children,
  confirmLabel,
  heading,
  onClose,
  open,
  pending = false,
  returnFocusRef,
}: {
  cancelLabel?: string;
  children: ReactNode;
  confirmLabel: string;
  heading: string;
  onClose: () => void;
  open: boolean;
  pending?: boolean;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    if (!open) return;

    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    cancelRef.current?.focus();

    return () => {
      if (dialog.open) dialog.close();
      returnFocusRef.current?.focus();
    };
  }, [open, returnFocusRef]);

  if (!open) return null;

  return (
    <dialog
      aria-describedby={bodyId}
      aria-labelledby={titleId}
      className="confirmation-dialog"
      onClick={(event) => {
        // A click on the backdrop lands on the dialog element itself; the
        // content fills the rest. Closing it is the safe outcome.
        if (event.target === event.currentTarget && !pending) onClose();
      }}
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onClose();
      }}
      ref={dialogRef}
    >
      <div className="confirmation-dialog__content">
        <h2 id={titleId}>{heading}</h2>
        <div id={bodyId}>{children}</div>
        <div className="actions">
          <button
            className="button--secondary"
            aria-disabled={pending || undefined}
            onClick={() => {
              if (!pending) onClose();
            }}
            ref={cancelRef}
            type="button"
          >
            {cancelLabel}
          </button>
          <button
            className="button--destructive"
            aria-disabled={pending || undefined}
            onClick={(event) => {
              if (pending) event.preventDefault();
            }}
            type="submit"
          >
            {pending ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
