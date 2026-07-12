"use client";

import { useActionState } from "react";
import { submitSupportTicketAction } from "../app/actions";
import { initialFormState } from "../lib/form-state";

export function SupportTicketForm() {
  const [state, action, pending] = useActionState(
    submitSupportTicketAction,
    initialFormState
  );

  return (
    <form action={action} className="form-stack">
      {state.message ? (
        <p className={`notice ${state.status}`} aria-live="polite">
          {state.message}
        </p>
      ) : null}

      <label>
        Email
        <input name="contact_email" type="email" autoComplete="email" required />
      </label>
      <label>
        Name
        <input name="name" autoComplete="name" maxLength={120} />
      </label>
      <label>
        Subject
        <input name="subject" required maxLength={160} />
      </label>
      <label>
        Message
        <textarea name="message" required maxLength={5000} rows={7} />
      </label>
      <p className="form-help">
        Support tickets are queued for review. Do not include passwords,
        payment card details, or other sensitive secrets.
      </p>
      <button type="submit" disabled={pending}>
        {pending ? "Submitting..." : "Submit support ticket"}
      </button>
    </form>
  );
}
