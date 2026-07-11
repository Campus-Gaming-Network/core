"use client";

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
        <p className={`notice ${state.status}`} aria-live="polite">
          {state.message}
        </p>
      ) : null}
      <label>
        Event password
        <input
          name="password"
          type="password"
          autoComplete="off"
          required
          minLength={8}
        />
      </label>
      <button type="submit" disabled={pending}>
        {pending ? "Unlocking…" : "Unlock event"}
      </button>
    </form>
  );
}
