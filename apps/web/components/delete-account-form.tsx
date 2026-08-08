"use client";

import { Alert } from "@heroui/react/alert";
import { Button } from "@heroui/react/button";
import { Input } from "@heroui/react/input";
import { useActionState } from "react";
import { deleteAccountAction } from "../app/actions";
import { initialFormState } from "../lib/form-state";

export function DeleteAccountForm() {
  const [state, action, pending] = useActionState(
    deleteAccountAction,
    initialFormState
  );

  return (
    <section className="action-panel" aria-labelledby="delete-account">
      <h2 id="delete-account">Delete your account</h2>
      <p>
        This removes your name, email, bio, social links, followed schools, and
        RSVPs, and cannot be undone. Events you created stay published so people
        who RSVP&apos;d keep their plans, but they will no longer be linked to
        you. Teams you own pass to a captain, or to another member if there is
        no captain.
      </p>
      <form action={action} className="form-stack">
        {state.message ? (
          <Alert status={state.status === "error" ? "danger" : "success"}>
            {state.message}
          </Alert>
        ) : null}
        <label>
          Type DELETE to confirm
          <Input
            name="confirm"
            autoComplete="off"
            required
            aria-describedby="delete-account-help"
          />
        </label>
        <p className="form-help" id="delete-account-help">
          Your email address becomes available for a new account afterwards.
        </p>
        <Button variant="secondary" type="submit" isDisabled={pending}>
          {pending ? "Deleting…" : "Delete account"}
        </Button>
      </form>
    </section>
  );
}
