import { useServerFn } from "@tanstack/react-start";
import { type FormEvent, useRef, useState } from "react";
import { ConfirmDialog } from "../../components/confirm-dialog";
import {
  FormErrorSummary,
  useEnhancedMutation,
} from "../../components/enhanced-mutation";
import { FormField } from "../../components/form-field";
import { FormSection } from "../../components/form-section";
import { deleteAccount } from "./account.functions";

/**
 * Deleting the account, set apart as the settings' danger zone: a red-edged
 * panel with the consequences spelled out, a typed confirmation, and a final
 * dialog. Without JavaScript the typed confirmation alone submits the form.
 */
export function DeleteAccountForm() {
  const runDelete = useServerFn(deleteAccount);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [confirming, setConfirming] = useState(false);
  const mutation = useEnhancedMutation(
    "We could not delete your account. Please try again.",
  );
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (!confirming && form.get("confirm") === "DELETE") {
      setConfirming(true);
      return;
    }
    await mutation.execute(() =>
      runDelete({ data: { confirm: String(form.get("confirm") ?? "") } }),
    );
  }
  const errors = mutation.fieldErrors.confirm;
  return (
    <section
      aria-labelledby="danger-zone-title"
      className="danger-zone"
      id="delete"
    >
      <h2 id="danger-zone-title">Danger zone</h2>
      <div className="danger-zone__body">
        <h3>Delete your account</h3>
        <p>
          This removes your profile, followed schools, and RSVPs and cannot be
          undone. An upcoming event you created passes to another organizer;
          without one it is cancelled and its attendees are emailed. Your other
          events are removed. A team you own passes to a captain, or else the
          longest-standing member, and is removed if no one else is on it.
        </p>
        <form
          action={deleteAccount.url}
          className="form-stack sectioned-form"
          method="post"
          onSubmit={submit}
        >
          {!confirming ? (
            <FormErrorSummary
              fieldErrors={mutation.fieldErrors}
              fieldIds={{ confirm: "delete-account-error" }}
              message={mutation.message}
              summaryRef={mutation.errorSummaryRef}
            />
          ) : null}
          <FormSection
            title="Confirm deletion"
            description="Your email address becomes available for a new account afterwards."
          >
            <FormField
              errorId="delete-account-error"
              errors={errors}
              label="Type DELETE to confirm"
            >
              <input name="confirm" autoComplete="off" required />
            </FormField>
          </FormSection>
          <div className="form-actions">
            <button
              className="button--destructive"
              disabled={mutation.pending}
              ref={triggerRef}
              type="submit"
            >
              Delete account
            </button>
          </div>
          <ConfirmDialog
            cancelLabel="Keep account"
            confirmLabel="Permanently delete account"
            heading="Permanently delete your account?"
            onClose={() => setConfirming(false)}
            open={confirming}
            pending={mutation.pending}
            returnFocusRef={triggerRef}
          >
            <p>
              This cannot be undone. Your profile, followed schools, and RSVPs
              will be removed.
            </p>
            {mutation.message ? <p role="alert">{mutation.message}</p> : null}
          </ConfirmDialog>
        </form>
      </div>
    </section>
  );
}
