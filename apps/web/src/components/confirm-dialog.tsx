import { useEffect, useRef, type ReactNode, type RefObject } from "react";

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
      aria-labelledby="confirmation-dialog-title"
      className="confirmation-dialog"
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onClose();
      }}
      ref={dialogRef}
    >
      <div className="confirmation-dialog__content">
        <h2 id="confirmation-dialog-title">{heading}</h2>
        <div>{children}</div>
        <div className="actions">
          <button
            className="button--secondary"
            disabled={pending}
            onClick={onClose}
            ref={cancelRef}
            type="button"
          >
            {cancelLabel}
          </button>
          <button
            className="button--destructive"
            disabled={pending}
            type="submit"
          >
            {pending ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
