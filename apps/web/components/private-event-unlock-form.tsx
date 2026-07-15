"use client";

import { Alert } from "@heroui/react/alert";
import { Button } from "@heroui/react/button";
import { Input } from "@heroui/react/input";
import { useActionState } from "react";
import { unlockEventAction } from "../app/actions";
import { initialFormState } from "../lib/form-state";

type PrivateEventUnlockFormProps = {
  slug: string;
};

export function PrivateEventUnlockForm({ slug }: PrivateEventUnlockFormProps) {
  const [state, action, pending] = useActionState(
    unlockEventAction,
    initialFormState
  );

  return (
    <form action={action} className="inline-form private-unlock-form">
      <input type="hidden" name="slug" value={slug} />
      {state.message ? (
        <Alert
          aria-live="polite"
      status={state.status === "error" ? "danger" : "success"}
        >
          {state.message}
        </Alert>
      ) : null}
      <label>
        Event password
        <Input
          name="password"
          type="password"
          autoComplete="off"
          required
          minLength={8}
        />
      </label>
      <Button type="submit" isDisabled={pending}>
        {pending ? "Unlocking…" : "Unlock event"}
      </Button>
    </form>
  );
}
