"use client";

import { Alert } from "@heroui/react/alert";
import { Button } from "@heroui/react/button";
import { Input } from "@heroui/react/input";
import { TextArea } from "@heroui/react/textarea";
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
        <Alert
          aria-live="polite"
      status={state.status === "error" ? "danger" : "success"}
        >
          {state.message}
        </Alert>
      ) : null}

      <label>
        Email
        <Input name="contact_email" type="email" autoComplete="email" required />
      </label>
      <label>
        Name
        <Input name="name" autoComplete="name" maxLength={120} />
      </label>
      <label>
        Subject
        <Input name="subject" required maxLength={160} />
      </label>
      <label>
        Message
        <TextArea name="message" required maxLength={5000} rows={7} />
      </label>
      <p className="form-help">
        Support tickets are queued for review. Do not include passwords,
        payment card details, or other sensitive secrets.
      </p>
      <Button type="submit" isDisabled={pending}>
        {pending ? "Submitting..." : "Submit support ticket"}
      </Button>
    </form>
  );
}
